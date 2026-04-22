# ESP32 Gateway Architecture (ESP-NOW)

In this architecture, your sensor nodes (Slaves) communicate with a central Gateway (Master) via **ESP-NOW**. The Gateway is the only device that needs to connect to the factory WiFi to reach the D2O Guard dashboard.

## 1. Setup Guide

### Step A: Find the Gateway MAC Address
You need the MAC address of your **Gateway ESP32** so the sensors know where to send data.
1. Upload this tiny script to your Gateway ESP32:
   ```cpp
   #include <WiFi.h>
   void setup() { Serial.begin(115200); WiFi.mode(WIFI_STA); Serial.println(WiFi.macAddress()); }
   void loop() {}
   ```
2. Open Serial Monitor and copy the MAC address (e.g., `AA:BB:CC:DD:EE:FF`).

---

## 2. Sensor Node Code (The "Slave")
Upload this to each sensor node. No WiFi password needed.

```cpp
#include <esp_now.h>
#include <WiFi.h>

// --- CONFIGURATION ---
uint8_t gatewayAddress[] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}; // Replace with your Gateway MAC
const char* zoneId = "REACTOR-A1"; // Unique ID for this specific sensor

const int inletPin = 13;
const int outletPin = 14;
volatile int inletPulseCount = 0;
volatile int outletPulseCount = 0;
float calibrationFactor = 4.5;

typedef struct struct_message {
    char zone_id[32];
    float inlet_flow;
    float outlet_flow;
    float flow_difference;
    char leak_status[32];
} struct_message;

struct_message myData;

void IRAM_ATTR pulseInlet() { inletPulseCount++; }
void IRAM_ATTR pulseOutlet() { outletPulseCount++; }

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  
  pinMode(inletPin, INPUT_PULLUP);
  pinMode(outletPin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(inletPin), pulseInlet, FALLING);
  attachInterrupt(digitalPinToInterrupt(outletPin), pulseOutlet, FALLING);

  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW Init Failed"); return; }
  
  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, gatewayAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) != ESP_OK) { Serial.println("Failed to add peer"); return; }
}

void loop() {
  static unsigned long lastTime = 0;
  if (millis() - lastTime > 3000) {
    lastTime = millis();
    
    float inlet = inletPulseCount / calibrationFactor;
    float outlet = outletPulseCount / calibrationFactor;
    inletPulseCount = 0; outletPulseCount = 0;
    
    strcpy(myData.zone_id, zoneId);
    myData.inlet_flow = inlet;
    myData.outlet_flow = outlet;
    myData.flow_difference = inlet - outlet;
    strcpy(myData.leak_status, (myData.flow_difference > 0.3) ? "Leak Detected" : "Normal");

    esp_err_t result = esp_now_send(gatewayAddress, (uint8_t *) &myData, sizeof(myData));
    if (result == ESP_OK) { Serial.println("Sent success"); } else { Serial.println("Sent fail"); }
  }
}
```

---

## 3. Gateway Node Code (The "Master")
Upload this to ONE ESP32 located near your router.

```cpp
#include <esp_now.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "https://YOUR-APP-URL.run.app/api/data";

typedef struct struct_message {
    char zone_id[32];
    float inlet_flow;
    float outlet_flow;
    float flow_difference;
    char leak_status[32];
} struct_message;

void OnDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
  struct_message myData;
  memcpy(&myData, incomingData, sizeof(myData));
  
  StaticJsonDocument<200> doc;
  doc["zone_id"] = myData.zone_id;
  doc["inlet_flow"] = myData.inlet_flow;
  doc["outlet_flow"] = myData.outlet_flow;
  doc["flow_difference"] = myData.flow_difference;
  doc["leak_status"] = myData.leak_status;

  String jsonString;
  serializeJson(doc, jsonString);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.POST(jsonString);
    http.end();
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP_STA); // AP_STA mode is required for ESP-NOW + WiFi
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi Connected");

  if (esp_now_init() != ESP_OK) { return; }
  esp_now_register_recv_cb(esp_now_recv_cb_t(OnDataRecv));
}

void loop() {}
```
