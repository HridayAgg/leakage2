import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import multer from "multer";
import fs from "fs";

const db = new Database("water_monitoring.db");

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer config for map upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, "factory_map.png"); // Always overwrite the same file for simplicity
  },
});
const upload = multer({ storage });

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS sensor_nodes (
    zone_id TEXT PRIMARY KEY,
    region TEXT,
    description TEXT,
    last_seen DATETIME,
    coordinates_x REAL,
    coordinates_y REAL,
    status TEXT DEFAULT 'OFFLINE',
    pending_command TEXT DEFAULT 'NONE',
    leak_threshold REAL DEFAULT 0.3
  );

  CREATE TABLE IF NOT EXISTS flow_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    zone_id TEXT,
    inlet_flow REAL,
    outlet_flow REAL,
    flow_difference REAL,
    leak_status TEXT
  );

  -- Seed some initial nodes if they don't exist
  INSERT OR IGNORE INTO sensor_nodes (zone_id, region, description, coordinates_x, coordinates_y) VALUES
  ('REACTOR-A1', 'Reactor Core', 'Primary Loop Inlet', 25, 30),
  ('REACTOR-A2', 'Reactor Core', 'Primary Loop Outlet', 25, 70),
  ('COOLANT-B1', 'Cooling Bay', 'Auxiliary Cooling', 50, 40),
  ('STORAGE-C1', 'Storage Yard', 'Heavy Water Tank 01', 75, 20),
  ('STORAGE-C2', 'Storage Yard', 'Heavy Water Tank 02', 75, 80),
  ('TRANSFER-D1', 'Transfer Hub', 'Factory Export Line', 85, 50);
`);

try {
  db.exec("ALTER TABLE sensor_nodes ADD COLUMN leak_threshold REAL DEFAULT 0.3");
} catch (e) {
  // Column likely already exists
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  // Broadcast to all connected clients
  const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  };

  // API to receive data from ESP32
  app.post("/api/data", (req, res) => {
    const { zone_id = "ZONE-01", inlet_flow = 0, outlet_flow = 0 } = req.body;
    const timestamp = new Date().toISOString();

    try {
      // 1. Fetch node config (threshold)
      const nodeConfig = db.prepare("SELECT leak_threshold, pending_command FROM sensor_nodes WHERE zone_id = ?").get(zone_id) as any;
      const threshold = nodeConfig?.leak_threshold || 0.3;
      const pendingCmd = nodeConfig?.pending_command || "NONE";

      // 2. Calculate derived data
      const flow_difference = Math.abs(inlet_flow - outlet_flow);
      const leak_status = flow_difference > threshold ? "Leak Detected" : "Normal";

      // 3. Update node status
      db.prepare(`
        INSERT INTO sensor_nodes (zone_id, last_seen, status)
        VALUES (?, ?, 'ONLINE')
        ON CONFLICT(zone_id) DO UPDATE SET 
          last_seen = excluded.last_seen,
          status = 'ONLINE'
      `).run(zone_id, timestamp);

      // 4. Save readings
      const stmt = db.prepare(`
        INSERT INTO flow_data (timestamp, zone_id, inlet_flow, outlet_flow, flow_difference, leak_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(timestamp, zone_id, inlet_flow, outlet_flow, flow_difference, leak_status);

      const newData = {
        timestamp,
        zone_id,
        inlet_flow,
        outlet_flow,
        flow_difference,
        leak_status
      };

      broadcast({ type: "NEW_DATA", data: newData });

      // Clear command after sending
      if (pendingCmd !== "NONE") {
        db.prepare("UPDATE sensor_nodes SET pending_command = 'NONE' WHERE zone_id = ?").run(zone_id);
      }

      res.status(200).json({ 
        status: "success", 
        command: pendingCmd 
      });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  // API to receive bulk data from a Gateway
  app.post("/api/data/bulk", (req, res) => {
    const readings = req.body; // Expecting an array
    if (!Array.isArray(readings)) return res.status(400).json({ error: "Invalid format" });

    const timestamp = new Date().toISOString();
    
    try {
      const transaction = db.transaction((data) => {
        for (const item of data) {
          const { zone_id, inlet_flow = 0, outlet_flow = 0 } = item;
          
          // Logic moved to server
          const node = db.prepare("SELECT leak_threshold FROM sensor_nodes WHERE zone_id = ?").get(zone_id) as any;
          const threshold = node?.leak_threshold || 0.3;
          const diff = Math.abs(inlet_flow - outlet_flow);
          const status = diff > threshold ? "Leak Detected" : "Normal";

          db.prepare(`
            INSERT INTO flow_data (timestamp, zone_id, inlet_flow, outlet_flow, flow_difference, leak_status)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(timestamp, zone_id, inlet_flow, outlet_flow, diff, status);

          broadcast({ 
            type: "NEW_DATA", 
            data: { 
              ...item, 
              timestamp, 
              flow_difference: diff, 
              leak_status: status 
            } 
          });
        }
      });

      transaction(readings);
      res.status(200).json({ status: "success", count: readings.length });
    } catch (error) {
      console.error("Bulk insert error:", error);
      res.status(500).json({ error: "Failed to process bulk data" });
    }
  });

  // API to get historical data
  app.get("/api/history", (req, res) => {
    const { zone_id } = req.query;
    try {
      let rows;
      if (zone_id) {
        rows = db.prepare("SELECT * FROM flow_data WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 100").all(zone_id);
      } else {
        rows = db.prepare("SELECT * FROM flow_data ORDER BY timestamp DESC LIMIT 100").all();
      }
      res.json(rows.reverse());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // API to get all nodes and status
  app.get("/api/nodes", (req, res) => {
    try {
      // Set nodes to offline if not seen for 30s
      db.prepare(`
        UPDATE sensor_nodes SET status = 'OFFLINE' 
        WHERE last_seen < datetime('now', '-30 seconds')
      `).run();
      
      const nodes = db.prepare("SELECT * FROM sensor_nodes").all();
      res.json(nodes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch nodes" });
    }
  });

  // Explicitly handle GET on /api/data to avoid SPA confusion
  app.get("/api/data", (req, res) => {
    res.json({ 
      status: "API Active", 
      message: "This endpoint accepts POST requests from sensor nodes." 
    });
  });

  // API to queue a command for a node (Bi-directional)
  app.post("/api/nodes/command", (req, res) => {
    const { zone_id, command } = req.body;
    try {
      db.prepare(`
        UPDATE sensor_nodes 
        SET pending_command = ? 
        WHERE zone_id = ?
      `).run(command, zone_id);
      res.json({ status: "success", zone_id, command });
    } catch (error) {
      res.status(500).json({ error: "Failed to queue command" });
    }
  });

  // API to update node position
  app.post("/api/nodes/position", (req, res) => {
    const { zone_id, coordinates_x, coordinates_y } = req.body;
    try {
      db.prepare(`
        UPDATE sensor_nodes 
        SET coordinates_x = ?, coordinates_y = ? 
        WHERE zone_id = ?
      `).run(coordinates_x, coordinates_y, zone_id);
      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update position" });
    }
  });

  // API to upload factory map
  app.post("/api/map/upload", upload.single("map"), (req, res) => {
    res.json({ status: "success", url: "/uploads/factory_map.png" });
  });

  // API to check if map exists
  app.get("/api/map/config", (req, res) => {
    const mapPath = path.join(uploadsDir, "factory_map.png");
    res.json({ 
      has_custom_map: fs.existsSync(mapPath),
      map_url: "/uploads/factory_map.png?t=" + Date.now() 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
