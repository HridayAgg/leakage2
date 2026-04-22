# ESP32 to Cloud Integration Guide

To connect your real ESP32 sensors to the **D2O Fleet Manager**, follow these steps.

## 1. Transmission Flow (Local vs Cloud)

### Option A: Local Testing (Same WiFi)
If you are running the dashboard on your laptop at the factory:
*   **Server URL**: `http://10.54.166.74:3000/api/data`
*   **Requirement**: Both ESP32 and Laptop must be on the same WiFi.

### Option B: Cloud Production (Remote Access)
If you want to monitor the pipes from anywhere:
*   **Server URL**: `https://ais-pre-kyzl3mm2fwr3afvwau2ipw-293758157053.asia-southeast1.run.app/api/data`
*   **Requirement**: ESP32 needs internet access.

---

## 2. The Data Format (JSON)
Your ESP32 must send a JSON payload to the `serverUrl`.

**Schema (Simplified):**
```json
{
  "zone_id": "REACTOR-A1", 
  "inlet_flow": 12.455,
  "outlet_flow": 12.380
}
```
*Note: The server now automatically calculates `flow_difference` and `leak_status` based on configurable thresholds.*

---

## 3. ESP32 Source Code (Hardware Edition)

This version uses **Interrupts** to count pulses from real Hall-effect flow sensors (like the YF-S201). 

**Wiring:**
*   **Inlet Sensor Signal**: Connect to **Pin 13**.
*   **Outlet Sensor Signal**: Connect to **Pin 14**.
*   **VCC**: 5V (or 3.3V depending on your sensor).
*   **GND**: Common Ground.

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- CONFIGURATION ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "https://ais-pre-kyzl3mm2fwr3afvwau2ipw-293758157053.asia-southeast1.run.app/api/data";
const char* zoneId = "REACTOR-A1"; 

// --- HARDWARE PINS ---
const int INLET_PIN = 13;
const int OUTLET_PIN = 14;

// --- CALIBRATION ---
// For YF-S201 sensors, Frequency (Hz) / 7.5 = Flow Rate (L/min)
const float CALIBRATION_FACTOR = 7.5;

volatile int pulseCountInlet = 0;
volatile int pulseCountOutlet = 0;

unsigned long lastTime = 0;

// Interrupt Service Routines (ISRs)
void IRAM_ATTR countInlet() {
  pulseCountInlet++;
}

void IRAM_ATTR countOutlet() {
  pulseCountOutlet++;
}

void setup() {
  Serial.begin(115200);
  
  pinMode(INLET_PIN, INPUT_PULLUP);
  pinMode(OUTLET_PIN, INPUT_PULLUP);
  
  attachInterrupt(digitalPinToInterrupt(INLET_PIN), countInlet, FALLING);
  attachInterrupt(digitalPinToInterrupt(OUTLET_PIN), countOutlet, FALLING);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  }
  Serial.println("\nWiFi Connected");
  lastTime = millis();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Update every 2 seconds
  if (currentTime - lastTime >= 2000) {
    detachInterrupt(digitalPinToInterrupt(INLET_PIN));
    detachInterrupt(digitalPinToInterrupt(OUTLET_PIN));
    
    // Calculate pulses per second (Hz)
    float flowIn = (pulseCountInlet / CALIBRATION_FACTOR) / 2.0; // Per second (L/s)
    float flowOut = (pulseCountOutlet / CALIBRATION_FACTOR) / 2.0;

    // Reset counters
    pulseCountInlet = 0;
    pulseCountOutlet = 0;
    lastTime = currentTime;
    
    attachInterrupt(digitalPinToInterrupt(INLET_PIN), countInlet, FALLING);
    attachInterrupt(digitalPinToInterrupt(OUTLET_PIN), countOutlet, FALLING);

    if (WiFi.status() == WL_CONNECTED) {
      StaticJsonDocument<128> doc;
      doc["zone_id"] = zoneId;
      doc["inlet_flow"] = flowIn;
      doc["outlet_flow"] = flowOut;

      String jsonPayload;
      serializeJson(doc, jsonPayload);

      WiFiClientSecure client; 
      client.setInsecure();

      HTTPClient http;
      http.begin(client, serverUrl);
      http.addHeader("Content-Type", "application/json");

      Serial.print("Sending Real Flow Data: ");
      Serial.print(flowIn); Serial.print(" -> "); Serial.println(flowOut);

      int httpResponseCode = http.POST(jsonPayload);
      if (httpResponseCode > 0) {
        String response = http.getString();
        Serial.println("Server Response: " + response);
      }
      http.end();
    }
  }
}
```

---

## 4. How to Receive Data (Dashboard to ESP32)
If you want the ESP32 to "receive" instructions (e.g., "Shut Valve"), the dashboard sends a JSON response to the `http.POST()` call.

**Update Server Logic:**
The server already returns `{ "status": "success" }`. You can modify `server.ts` to include commands:
```json
{
  "status": "success",
  "command": "CLOSE_VALVE"
}
```

**ESP32 Handling:**
In your code, parse the `response` string:
```cpp
if (httpResponseCode == 200) {
   String response = http.getString();
   StaticJsonDocument<200> resDoc;
   deserializeJson(resDoc, response);
   
   if (resDoc["command"] == "CLOSE_VALVE") {
      digitalWrite(VALVE_PIN, LOW); // Close the physical valve
   }
}
```

---

## 5. Deployment Step-by-Step
1.  **Configure WiFi**: Update `ssid` and `password` in the code above.
2.  **App URL**: Find your **Shared App URL** from the AI Studio header and paste it into `serverUrl`.
3.  **Flash ESP32**: Upload the code using Arduino IDE or PlatformIO.
4.  **Monitor Map**: Open the D2O Fleet Manager. Within 3 seconds of the ESP32 starting, it will turn **ONLINE (Green)** on the map and display live data.
