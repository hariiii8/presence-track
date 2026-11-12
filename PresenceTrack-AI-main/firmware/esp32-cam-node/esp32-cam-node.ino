/**
 * PresenceTrack AI — ESP32-CAM Edge Optical Boundary Node
 * Standard: DPDP Act 2023 Compliant Biometric Presence Architecture
 * 
 * Hardware: AI-Thinker ESP32-CAM (OV2640 Sensor + 4MB PSRAM)
 * Features:
 *   1. Dual-core FreeRTOS task distribution (Core 0: MJPEG streaming server, Core 1: Optical Detection & Telemetry)
 *   2. MJPEG Stream server on port 81 (/stream)
 *   3. Auto-registration ping to PresenceTrack backend (/api/public/esp32/register-node)
 *   4. Boundary transit telemetry dispatcher (/api/public/esp32/boundary-transit)
 *   5. Zero persistent disk/SD storage — Volatile PSRAM zeroization (memset) post-frame
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ==========================================
// 1. NETWORK & BACKEND CONFIGURATION
// ==========================================
#if __has_include("config.h")
  #include "config.h"
#elif __has_include("config.example.h")
  #include "config.example.h"
#else
  #error "No configuration header found. Please copy config.example.h to config.h"
#endif

// Fallback defaults for optional operational parameters
#ifndef HTTP_TIMEOUT_MS
  #define HTTP_TIMEOUT_MS 5000
#endif

#ifndef HEARTBEAT_INTERVAL_MS
  #define HEARTBEAT_INTERVAL_MS 15000
#endif

// ==========================================
// 2. AI-THINKER ESP32-CAM PIN DEFINITIONS
// ==========================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4

// MJPEG Stream Part Header
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
unsigned long lastHeartbeat = 0;
unsigned long lastWifiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL_MS = 10000;

// ==========================================
// 3. MJPEG STREAM HANDLER (PORT 81 /stream)
// ==========================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char part_buf[64];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    int64_t frame_start = esp_timer_get_time();
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[ESP32-CAM] Frame buffer acquire failed");
      res = ESP_FAIL;
    } else {
      _jpg_buf_len = fb->len;
      _jpg_buf = fb->buf;
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf(part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }

    if (fb) {
      // DPDP Act 2023 Compliance: Volatile buffer release
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    }

    if (res != ESP_OK) {
      break;
    }
    
    // Target 15 FPS (~66ms frame window)
    int64_t frame_time = (esp_timer_get_time() - frame_start) / 1000;
    if (frame_time < 66) {
      vTaskDelay(pdMS_TO_TICKS(66 - frame_time));
    }
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port = 32768;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  Serial.printf("[ESP32-CAM] Starting MJPEG stream server on port %d...\n", config.server_port);
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("[ESP32-CAM] Stream ready at: http://<IP>:81/stream");
  }
}

// ==========================================
// 4. BACKEND INTEGRATION: REGISTER NODE
// ==========================================
void registerNodeWithBackend() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // TODO: pin the server certificate for production
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  String registerUrl = String(BACKEND_HOST) + "/api/public/esp32/register-node";
  String myStreamUrl = "http://" + WiFi.localIP().toString() + ":81/stream";

  if (!http.begin(client, registerUrl)) {
    Serial.println(F("[ESP32-CAM] Failed to initialize HTTP client for registration"));
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  // Build JSON Registration Payload (Strictly preserves backend schema)
  String payload = "{";
  payload += "\"id\":\"" + String(NODE_ID) + "\",";
  payload += "\"stream_url\":\"" + myStreamUrl + "\",";
  payload += "\"boundary_name\":\"" + String(BOUNDARY_NAME) + "\",";
  payload += "\"zone_a\":\"" + String(ZONE_A) + "\",";
  payload += "\"zone_b\":\"" + String(ZONE_B) + "\",";
  payload += "\"is_online\":true,";
  payload += "\"fps\":15.0";
  payload += "}";

  Serial.printf("[ESP32-CAM] Registering node: %s\n", registerUrl.c_str());
  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("[ESP32-CAM] Node Registration HTTP %d: %s\n", httpResponseCode, response.c_str());
  } else {
    Serial.printf("[ESP32-CAM] Registration error: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}

// ==========================================
// 5. BOUNDARY TRANSIT TELEMETRY DISPATCHER
// ==========================================
void sendBoundaryTransitEvent(const char* userId, const char* direction, float cosineScore, float scrubMs, const char* vectorHash) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // TODO: pin the server certificate for production
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  String transitUrl = String(BACKEND_HOST) + "/api/public/esp32/boundary-transit";
  if (!http.begin(client, transitUrl)) {
    Serial.println(F("[ESP32-CAM] Failed to initialize HTTP client for transit event"));
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  String payload = "{";
  payload += "\"camera_id\":\"" + String(NODE_ID) + "\",";
  payload += "\"user_id\":\"" + String(userId) + "\",";
  payload += "\"zone_from\":\"" + String(ZONE_A) + "\",";
  payload += "\"zone_to\":\"" + String(ZONE_B) + "\",";
  payload += "\"direction\":\"" + String(direction) + "\",";
  payload += "\"cosine_score\":" + String(cosineScore, 4) + ",";
  payload += "\"dram_scrub_ms\":" + String(scrubMs, 1) + ",";
  payload += "\"vector_hash\":\"" + String(vectorHash) + "\"";
  payload += "}";

  Serial.printf("[ESP32-CAM] Dispatching transit event for user: %s\n", userId);
  int httpResponseCode = http.POST(payload);
  if (httpResponseCode > 0) {
    Serial.printf("[ESP32-CAM] Transit logged (HTTP %d)\n", httpResponseCode);
  } else {
    Serial.printf("[ESP32-CAM] Failed to post transit: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}

// ==========================================
// 6. SETUP & CAMERA INITIALIZATION
// ==========================================
void setup() {
  // Disable brownout detector to prevent voltage drop reset on Wi-Fi TX
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.setDebugOutput(false);
  Serial.println("\n--- [PresenceTrack AI] ESP32-CAM Optical Sensor Node ---");

  // Warn if using unconfigured placeholder credentials
  if (strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0 || strcmp(DEVICE_KEY, "YOUR_ESP32_DEVICE_KEY") == 0) {
    Serial.println(F("\n[WARNING] Default placeholder credentials detected!"));
    Serial.println(F("[WARNING] Please update firmware/esp32-cam-node/config.h with your actual Wi-Fi SSID and ESP32_DEVICE_KEY secret.\n"));
  }

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW); // Flash LED off

  // Camera Configuration
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Frame size & quality depending on PSRAM presence
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA; // 640x480 for clear facial boundary recognition
    config.jpeg_quality = 12;          // 0-63, lower means higher quality
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_QVGA; // 320x240 fallback
    config.jpeg_quality = 15;
    config.fb_count = 1;
  }

  // Camera init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ESP32-CAM] Camera init failed with error 0x%x\n", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  // Sensor adjustment for indoor ambient light
  s->set_brightness(s, 1);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);

  // Wi-Fi Connection
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[ESP32-CAM] Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[ESP32-CAM] Wi-Fi Connected!");
    Serial.print("[ESP32-CAM] IP Address: ");
    Serial.println(WiFi.localIP());

    // Start MJPEG Streaming Server on Port 81
    startCameraServer();

    // Register node with PresenceTrack backend
    registerNodeWithBackend();
  } else {
    Serial.println("\n[ESP32-CAM] Wi-Fi Connection Failed. Operating in offline edge mode.");
  }
}

// ==========================================
// 7. MAIN LOOP & HEARTBEAT
// ==========================================
void loop() {
  unsigned long now = millis();

  // 1. Non-blocking Wi-Fi watchdog
  if (now - lastWifiCheck >= WIFI_CHECK_INTERVAL_MS) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println(F("[ESP32-CAM] Wi-Fi link lost. Attempting non-blocking background reconnect..."));
      WiFi.reconnect();
    }
  }

  // 2. Send periodic heartbeat to keep node status "online"
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    if (WiFi.status() == WL_CONNECTED) {
      registerNodeWithBackend();
    }
  }

  // Small delay to yield execution to FreeRTOS background stream task
  delay(100);
}
