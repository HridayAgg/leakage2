# ESP32 Integration Guide for D2O Guard

To connect your real ESP32 sensors to this dashboard, use the following Arduino code. This code reads from two flow sensors (Inlet and Outlet), calculates the difference, and sends the data to the dashboard via HTTP POST.

## 1. Hardware Setup
- **ESP32 Microcontroller**
- **2x Flow Sensors** (e.g., YF-S201)
- **Inlet Sensor Pin**: GPIO 13 (Example)
- **Outlet Sensor Pin**: GPIO 14 (Example)

## 2. Arduino Code

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- CONFIGURATION ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Replace with your actual App URL from the dashboard
const char* serverUrl = "https://YOUR-APP-URL.run.app/api/data";
const char* zoneId = "REACTOR-A1"; // Unique ID for this pipeline section

// Sensor Pins
const int inletPin = 13;
const int outletPin = 14;

// Flow Calculation Variables
volatile int inletPulseCount = 0;
volatile int outletPulseCount = 0;
float calibrationFactor = 4.5; // Adjust based on your sensor datasheet

void IRAM_ATTR pulseInlet() { inletPulseCount++; }
void IRAM_ATTR pulseOutlet() { outletPulseCount++; }

void setup() {
  Serial.begin(115200);
  
  pinMode(inletPin, INPUT_PULLUP);
  pinMode(outletPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(inletPin), pulseInlet, FALLING);
  attachInterrupt(digitalPinToInterrupt(outletPin), pulseOutlet, FALLING);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");
}

void loop() {
  static unsigned long lastTime = 0;
  if (millis() - lastTime > 3000) { // Send data every 3 seconds
    lastTime = millis();

    // Calculate Flow Rates (L/min or kg/s)
    float inletFlow = (inletPulseCount / calibrationFactor);
    float outletFlow = (outletPulseCount / calibrationFactor);
    inletPulseCount = 0;
    outletPulseCount = 0;

    float diff = inletFlow - outletFlow;
    const char* status = (diff > 0.3) ? "Leak Detected" : "Normal";

    // Prepare JSON
    StaticJsonDocument<200> doc;
    doc["zone_id"] = zoneId;
    doc["inlet_flow"] = inletFlow;
    doc["outlet_flow"] = outletFlow;
    doc["flow_difference"] = diff;
    doc["leak_status"] = status;

    String jsonString;
    serializeJson(doc, jsonString);

    // Send HTTP POST
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");
      
      int httpResponseCode = http.POST(jsonString);
      
      if (httpResponseCode > 0) {
        Serial.print("HTTP Response code: ");
        Serial.println(httpResponseCode);
      } else {
        Serial.print("Error code: ");
        Serial.println(httpResponseCode);
      }
      http.end();
    }
  }
}
```

## 3. Deployment Steps
1.  **Install Libraries**: In Arduino IDE, go to `Sketch` -> `Include Library` -> `Manage Libraries` and install **ArduinoJson**.
2.  **Update Credentials**: Replace `YOUR_WIFI_SSID`, `YOUR_WIFI_PASSWORD`, and `serverUrl` in the code.
3.  **Flash ESP32**: Upload the code to your ESP32.
4.  **Monitor**: Open the Serial Monitor (115200 baud) to see the connection status and HTTP response codes.
5.  **View Dashboard**: Your real-time data will appear on the D2O Guard dashboard under the specified `zone_id`.
