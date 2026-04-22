import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Droplets, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  AlertTriangle, 
  CheckCircle2,
  History,
  RefreshCw,
  Play,
  Square,
  Map as MapIcon,
  LayoutDashboard,
  Radio,
  Zap,
  Shield,
  Upload,
  Crosshair,
  Settings,
  Trash2,
  Lock,
  Unlock
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

// Interfaces
interface FlowData {
  zone_id: string;
  timestamp: string;
  inlet_flow: number;
  outlet_flow: number;
  flow_difference: number;
  leak_status: string;
}

interface SensorNode {
  zone_id: string;
  region: string;
  description: string;
  last_seen: string;
  coordinates_x: number;
  coordinates_y: number;
  status: 'ONLINE' | 'OFFLINE';
}

export default function App() {
  const [data, setData] = useState<FlowData[]>([]);
  const [nodes, setNodes] = useState<SensorNode[]>([]);
  const [latest, setLatest] = useState<FlowData | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'map'>('dashboard');
  const [mapConfig, setMapConfig] = useState({ has_custom_map: false, map_url: '' });
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch Nodes and Status
  const refreshNodes = () => {
    fetch('/api/nodes')
      .then(res => res.json())
      .then(nodesData => {
        setNodes(nodesData);
        if (!activeZone && nodesData.length > 0) {
          setActiveZone(nodesData[0].zone_id);
        }
      });
  };

  const fetchMapConfig = () => {
    fetch('/api/map/config')
      .then(res => res.json())
      .then(setMapConfig);
  };

  useEffect(() => {
    refreshNodes();
    fetchMapConfig();
    const interval = setInterval(refreshNodes, 5000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'NEW_DATA') {
        if (message.data.zone_id === activeZone) {
          setLatest(message.data);
          setData(prev => [...prev.slice(-49), message.data]);
        }
        // Force refresh nodes on new data to update online status immediately
        refreshNodes();
      }
    };

    socket.onopen = () => setIsConnected(true);
    socket.onclose = () => setIsConnected(false);

    return () => socket.close();
  }, [activeZone]);

  // Initial Data Fetch
  useEffect(() => {
    if (!activeZone) return;
    fetch(`/api/history?zone_id=${activeZone}`)
      .then(res => res.json())
      .then(history => {
        if (Array.isArray(history)) {
          setData(history);
          setLatest(history[history.length - 1] || null);
        }
      });
  }, [activeZone]);

  // Simulation Logic
  useEffect(() => {
    let interval: any;
    if (isSimulating) {
      interval = setInterval(() => {
        nodes.forEach(node => {
          const inlet = (node.region === 'Reactor Core' ? 25 : 12) + Math.random() * 2;
          const leak = Math.random() > 0.95;
          const outlet = leak ? inlet - (1 + Math.random()) : inlet - (Math.random() * 0.02);
          
          fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              zone_id: node.zone_id,
              inlet_flow: Number(inlet.toFixed(3)),
              outlet_flow: Number(outlet.toFixed(3))
            })
          });
        });
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isSimulating, nodes]);

  const stats = useMemo(() => {
    if (!latest) return null;
    return [
      { label: 'Inlet Flow', value: latest.inlet_flow.toFixed(3), unit: 'kg/s', icon: ArrowDownToLine, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
      { label: 'Outlet Flow', value: latest.outlet_flow.toFixed(3), unit: 'kg/s', icon: ArrowUpFromLine, color: 'text-blue-400', bg: 'bg-blue-500/10' },
      { label: 'Difference', value: latest.flow_difference.toFixed(3), unit: 'kg/s', icon: Droplets, color: latest.flow_difference > 0.3 ? 'text-rose-400' : 'text-emerald-400', bg: latest.flow_difference > 0.3 ? 'bg-rose-500/10' : 'bg-emerald-500/10' }
    ];
  }, [latest]);

  const handleMapUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('map', file);

    try {
      await fetch('/api/map/upload', {
        method: 'POST',
        body: formData
      });
      fetchMapConfig();
    } catch (err) {
      console.error('Failed to upload map:', err);
    }
  };

  const updateNodePosition = async (zone_id: string, x: number, y: number) => {
    try {
      await fetch('/api/nodes/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id, coordinates_x: x, coordinates_y: y })
      });
      refreshNodes();
    } catch (err) {
      console.error('Failed to update node position:', err);
    }
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCalibrating || !selectedNodeId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    updateNodePosition(selectedNodeId, x, y);
    setSelectedNodeId(null);
  };

  const sendValveCommand = async (command: 'CLOSE_VALVE' | 'OPEN_VALVE') => {
    if (!activeZone) return;
    try {
      await fetch('/api/nodes/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: activeZone, command })
      });
      alert(`Command Queued: ${command} for ${activeZone}. It will be sent on the next sensor heartbeat.`);
    } catch (err) {
      console.error('Failed to send command:', err);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto industrial-grid">
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
            <Radio className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase">D2O Fleet Manager</h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase">
              Factory Containment Network // {nodes.filter(n => n.status === 'ONLINE').length}/{nodes.length} Active Nodes
            </p>
          </div>
        </div>

        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button 
            onClick={() => setView('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${view === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button 
            onClick={() => setView('map')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${view === 'map' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <MapIcon className="w-4 h-4" />
            Factory Map
          </button>
        </div>
      </header>

      {view === 'map' ? (
        /* Plant Layout View */
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Tactical Plant Layout</h2>
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded border ${isCalibrating ? 'bg-blue-500/20 border-blue-500 text-blue-400 animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                  {isCalibrating ? 'CALIBRATION MODE ACTIVE' : 'MONITORING MODE'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-300 transition-all border border-slate-700">
                  <Upload className="w-3 h-3" />
                  Upload Map
                  <input type="file" className="hidden" accept="image/*" onChange={handleMapUpload} />
                </label>
                <button 
                  onClick={() => setIsCalibrating(!isCalibrating)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${isCalibrating ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
                >
                  <Crosshair className="w-3 h-3" />
                  {isCalibrating ? 'Exit Calibration' : 'Calibrate Nodes'}
                </button>
              </div>
            </div>

            <div 
              className="map-container h-[600px]" 
              onClick={handleMapClick}
              style={{
                backgroundImage: mapConfig.has_custom_map ? `url(${mapConfig.map_url})` : undefined,
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat'
              }}
            >
              {!mapConfig.has_custom_map && (
                <>
                  <div className="map-zone-label" style={{ top: '10%', left: '20%' }}>Process Wing A</div>
                  <div className="map-zone-label" style={{ top: '10%', left: '70%' }}>Storage Sector</div>
                  <div className="map-zone-label" style={{ bottom: '10%', left: '50%' }}>Cooling Facility</div>
                  <div className="map-zone-label" style={{ bottom: '10%', left: '10%' }}>Reactor Enclosure</div>

                  <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <svg className="w-full h-full">
                      <rect x="5%" y="5%" width="30%" height="40%" rx="8" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4" />
                      <rect x="60%" y="5%" width="35%" height="90%" rx="8" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4" />
                      <circle cx="25%" cy="75%" r="100" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4" />
                    </svg>
                  </div>
                </>
              )}

              {/* Sensors on Map */}
              {nodes.map(node => (
                <motion.div
                  key={node.zone_id}
                  initial={{ scale: 0 }}
                  animate={{ 
                    scale: selectedNodeId === node.zone_id ? 1.8 : 1,
                    zIndex: selectedNodeId === node.zone_id ? 50 : 10
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCalibrating) {
                      setSelectedNodeId(node.zone_id);
                    } else {
                      setActiveZone(node.zone_id);
                      setView('dashboard');
                    }
                  }}
                  className={`group map-node ${node.status === 'ONLINE' ? (node.zone_id === activeZone ? 'bg-blue-500' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]') : 'bg-slate-700 opacity-50'}`}
                  style={{ top: `${node.coordinates_y}%`, left: `${node.coordinates_x}%` }}
                >
                  {(node.status === 'ONLINE' || isCalibrating) && (
                    <div className={`node-pulse ${selectedNodeId === node.zone_id ? 'bg-blue-400 animate-bounce' : node.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                  )}
                  
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[9px] font-black text-white opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none shadow-2xl z-50">
                    <div className="flex flex-col gap-0.5">
                      <span>{node.zone_id}</span>
                      <span className="text-slate-500 text-[7px]">{node.region}</span>
                    </div>
                  </div>
                </motion.div>
              ))}

              {isCalibrating && !selectedNodeId && (
                <div className="absolute inset-0 bg-blue-500/5 pointer-events-none flex items-center justify-center">
                  <div className="px-4 py-2 bg-slate-900/90 border border-blue-500/50 rounded-xl text-[10px] font-black text-blue-400 uppercase tracking-widest backdrop-blur-md">
                    Select a node to relocate
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Node List / Legend */}
          <div className="lg:col-span-1 glass-panel flex flex-col h-[650px]">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/30">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Node Inventory</h2>
              <Settings className="w-3 h-3 text-slate-600" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {nodes.map(node => (
                <div 
                  key={node.zone_id}
                  onClick={() => {
                    if (isCalibrating) setSelectedNodeId(node.zone_id);
                    else setActiveZone(node.zone_id);
                  }}
                  className={`group p-3 rounded-lg border transition-all relative ${
                    selectedNodeId === node.zone_id
                      ? 'bg-blue-600 border-blue-400 shadow-lg shadow-blue-900/30'
                      : node.zone_id === activeZone 
                        ? 'bg-slate-800 border-slate-600 shadow-inner' 
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-black uppercase ${selectedNodeId === node.zone_id ? 'text-white' : 'text-slate-300'}`}>{node.zone_id}</span>
                    <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[7px] font-black border ${
                      node.status === 'ONLINE' 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}>
                      <div className={`w-1 h-1 rounded-full ${node.status === 'ONLINE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                      {node.status}
                    </div>
                  </div>
                  <p className={`text-[9px] font-bold uppercase ${selectedNodeId === node.zone_id ? 'text-blue-100' : 'text-slate-500'}`}>{node.region}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Original Dashboard Content with Zone Switcher */
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
            <div className="lg:col-span-1 glass-panel p-4">
              <label className="text-[9px] font-black uppercase text-slate-500 mb-2 block">Active Sensor Feed</label>
              <select 
                value={activeZone || ''} 
                onChange={(e) => setActiveZone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-bold text-white outline-none focus:border-blue-500 transition-colors"
              >
                {nodes.map(n => (
                  <option key={n.zone_id} value={n.zone_id}>
                    {n.zone_id} {n.status === 'OFFLINE' ? '(OFFLINE)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2 flex items-center justify-end gap-3 px-4">
               {isSimulating ? (
                 <div className="flex items-center gap-3 px-4 py-2 bg-rose-500/10 border border-rose-500/50 rounded-xl animate-pulse">
                   <Zap className="w-4 h-4 text-rose-500" />
                   <span className="text-[10px] font-black uppercase text-rose-500">Virtual Simulation Active</span>
                 </div>
               ) : (
                 <div className="flex items-center gap-3 px-4 py-2 bg-emerald-500/10 border border-emerald-500/50 rounded-xl">
                   <Activity className="w-4 h-4 text-emerald-500" />
                   <span className="text-[10px] font-black uppercase text-emerald-500">Live Hardware Stream</span>
                 </div>
               )}
               <button 
                 onClick={() => setIsSimulating(!isSimulating)} 
                 className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${
                   isSimulating 
                     ? 'bg-rose-600 border-rose-500 text-white hover:bg-rose-700' 
                     : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-blue-500 hover:text-blue-400'
                 }`}
               >
                 {isSimulating ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                 {isSimulating ? 'Stop Virtual Test' : 'Run Virtual Test'}
               </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Copy existing Metric card logic here ... */}
            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
              {stats?.map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={`glass-panel metric-card border-l-4 border-slate-800 ${stat.bg}`}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{stat.label}</span>
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-black font-mono tracking-tighter ${stat.color}`}>{stat.value}</span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase">{stat.unit}</span>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Status Card */}
            <motion.div className={`lg:col-span-1 glass-panel p-6 flex flex-col border-2 ${latest?.leak_status === 'Leak Detected' ? 'bg-rose-950/20 border-rose-500 alarm-pulse' : 'bg-emerald-950/20 border-emerald-500/30'}`}>
               <div className="flex flex-col items-center justify-center text-center flex-1">
                 <div className="mb-4">
                   {latest?.leak_status === 'Leak Detected' ? <AlertTriangle className="w-16 h-16 text-rose-500" /> : <Shield className="w-16 h-16 text-emerald-500/40" />}
                 </div>
                 <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Security Invariant</h3>
                 <p className={`text-xl font-black uppercase mt-1 ${latest?.leak_status === 'Leak Detected' ? 'text-rose-400' : 'text-emerald-400'}`}>{latest?.leak_status || 'IDLE'}</p>
               </div>

               {/* Command Center */}
               <div className="mt-6 pt-6 border-t border-slate-800">
                  <p className="text-[8px] font-black uppercase text-slate-600 mb-3 tracking-widest">Actuator Override</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => sendValveCommand('CLOSE_VALVE')}
                      className="flex flex-col items-center justify-center gap-2 p-3 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 rounded-lg group transition-all"
                    >
                      <Lock className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform" />
                      <span className="text-[8px] font-black text-rose-400 uppercase">Emergency Stop</span>
                    </button>
                    <button 
                      onClick={() => sendValveCommand('OPEN_VALVE')}
                      className="flex flex-col items-center justify-center gap-2 p-3 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/30 rounded-lg group transition-all"
                    >
                      <Unlock className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
                      <span className="text-[8px] font-black text-emerald-400 uppercase">Restore Flow</span>
                    </button>
                  </div>
               </div>
            </motion.div>

            {/* Chart */}
            <div className="lg:col-span-4 glass-panel p-6 overflow-hidden">
               <div className="h-[300px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                   <AreaChart data={data}>
                     <XAxis dataKey="timestamp" tickFormatter={(val) => new Date(val).toLocaleTimeString()} stroke="#334155" fontSize={10} />
                     <YAxis stroke="#334155" fontSize={10} />
                     <Area type="stepAfter" dataKey="inlet_flow" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.1} />
                     <Area type="stepAfter" dataKey="outlet_flow" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} />
                   </AreaChart>
                 </ResponsiveContainer>
               </div>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <footer className="mt-12 text-[10px] font-bold text-slate-600 text-center uppercase tracking-widest border-t border-slate-900 pt-8">
        D2O Guard // Global Fleet State Vector // {new Date().getFullYear()}
      </footer>
    </div>
  );
}
