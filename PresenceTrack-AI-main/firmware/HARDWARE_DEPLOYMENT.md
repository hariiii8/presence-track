# ESP32-CAM Hardware Deployment & Flashing Guide

**Project:** PresenceTrack AI  
**Target Hardware:** AI-Thinker ESP32-CAM (OV2640 Sensor + 4MB PSRAM)  
**Programmer Module:** HW-381 ESP32-CAM-MB Micro-USB Daughterboard (CH340G / CP2102)

---

## 1. Safety & Compliance Architecture (DPDP Act 2023)

PresenceTrack AI uses an **ephemeral edge capture pipeline**:
- The ESP32-CAM captures raw frames into volatile PSRAM (`esp_camera_fb_get()`) and immediately streams them via MJPEG on port 81 (`/stream`).
- The frame buffer is immediately recycled (`esp_camera_fb_return()`).
- **Zero local persistence**: No images, embeddings, or personally identifiable information (PII) are stored on the ESP32-CAM or any external storage.
- **MicroSD slot must remain empty**: Do NOT insert a microSD card into the slot. The SD card interface shares GPIOs 2, 4, 12, 13, 14, and 15 with the camera bus and status LED. Inserting a card can cause bus contention, frame drops, or brownout panics.

---

## 2. Hardware Preparation & Power Requirements

### Power Supply (Critical)
The ESP32-CAM with OV2640 and active Wi-Fi radio draws up to **500mA–800mA peak currents** during RF transmission and frame capture:
- **Requirement:** Regulated **5.0V DC with at least 2.0A rating**.
- **Brownout Prevention:** If the node bootloops or resets (`Brownout detector was triggered`), connect a **1000 µF / 10V electrolytic capacitor** directly across the 5V and GND pins on the ESP32-CAM board.
- Avoid unpowered USB hubs or long, thin USB cables which exhibit voltage drop.

### Optical & Mounting Geometry
For accurate facial detection and spatial tracking across boundary transit lines:
- **Mounting Height:** 2.0 meters – 2.2 meters from the floor.
- **Depression Angle (Tilt):** 12° to 15° downward toward the boundary transit threshold.
- **Ambient Lighting:** Minimum 150 lux at facial plane; avoid direct backlighting from windows or bright ceiling spotlights positioned directly behind subjects.
- **Lens Focus:** Gently rotate the OV2640 lens ring until facial features are sharp at the 1.5m to 2.5m transit capture distance. (Apply a small dab of non-conductive adhesive once focused).

---

## 3. Configuration Setup (`config.h`)

Before compiling or flashing, create your private configuration file:

1. Copy the example template:
   ```bash
   cp firmware/esp32-cam-node/config.example.h firmware/esp32-cam-node/config.h
   ```
2. Open `firmware/esp32-cam-node/config.h` in your editor and configure:
   - `WIFI_SSID`: Your 2.4 GHz Wi-Fi network name (ESP32 does not support 5 GHz).
   - `WIFI_PASSWORD`: Your Wi-Fi password.
   - `BACKEND_HOST`: Your PresenceTrack instance URL (e.g., `https://your-app.lovable.app`).
   - `DEVICE_KEY`: Must match the secret `ESP32_DEVICE_KEY` configured in your backend.
   - `NODE_ID`: Unique node identifier (e.g., `"ESP32-CAM-01-NORTH"`).
   - `BOUNDARY_NAME`: Logical threshold name (e.g., `"Corridor -> Workspace Floor"`).
   - `ZONE_A`: Source zone (e.g., `"CORRIDOR_TRANSIT"`).
   - `ZONE_B`: Destination zone (e.g., `"WORKSPACE_FLOOR"`).

> [!IMPORTANT]
> `firmware/esp32-cam-node/config.h` is strictly git-ignored. Never commit real credentials to source control.

---

## 4. Flashing Procedure via HW-381 Daughterboard

The HW-381 daughterboard plugs directly underneath the ESP32-CAM module, providing Micro-USB power, serial communication, and auto-reset circuitry.

### Step 1: macOS Driver Verification
1. Connect the HW-381 + ESP32-CAM to your Mac using a quality data USB cable.
2. Check for the detected serial device in Terminal:
   ```bash
   ls /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART*
   ```
   - If using a **CH340G** chip and device does not appear, install the macOS CH34x driver (V3.4+ supports Apple Silicon macOS 12+).
   - If using a **CP2102** chip, macOS includes built-in driver support (`/dev/cu.SLAB_USBtoUART`).

### Step 2: Flashing via PlatformIO (Recommended)
If using VS Code with PlatformIO:
1. Open the `/Users/venkatpk/Downloads/project_vh/firmware` directory in VS Code.
2. PlatformIO will automatically recognize `platformio.ini`.
3. Press **PlatformIO: Build** to compile.
4. Press **PlatformIO: Upload** to flash the firmware.

If using PlatformIO Core CLI:
```bash
cd firmware
pio run -e esp32cam --target upload
```

### Step 3: Flashing via Arduino IDE (Alternative)
If flashing via Arduino IDE 2.x:
1. Open Arduino IDE and add the ESP32 board package URL in Preferences:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. Install **esp32 by Espressif Systems** via Boards Manager.
3. Open `firmware/esp32-cam-node/esp32-cam-node.ino`.
4. Configure Board Settings under **Tools**:
   - **Board:** `AI Thinker ESP32-CAM`
   - **CPU Frequency:** `240MHz (WiFi/BT)`
   - **Flash Frequency:** `80MHz`
   - **Flash Mode:** `QIO`
   - **Partition Scheme:** `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **Core Debug Level:** `None` (or `Info` during initial debug)
   - **Port:** Select your USB serial port (`/dev/cu.wchusbserial...`)
5. Click **Upload**.
   - If upload fails with `A fatal error occurred: Failed to connect to ESP32: Timed out waiting for packet header`:
     - Press and hold the **BOOT / IO0** button on the HW-381 board while uploading starts, then release.

---

## 5. First-Boot Verification Checklist

Once flashing completes:

1. **Serial Monitor Verification:**
   - Open Serial Monitor at **115200 baud**.
   - Press the **RST** button on the ESP32-CAM.
   - Look for the initial output:
     ```
     --- [PresenceTrack AI] ESP32-CAM Optical Sensor Node ---
     [ESP32-CAM] Connecting to Wi-Fi: <SSID> ..........
     [ESP32-CAM] Wi-Fi connected! Local IP: 192.168.1.xxx
     [ESP32-CAM] MJPEG stream ready at: http://192.168.1.xxx:81/stream
     [ESP32-CAM] Registering node with backend: https://...
     [ESP32-CAM] Backend registration succeeded. HTTP status: 200
     ```

2. **Stream Quality & Latency Check:**
   - Open a browser on the same Wi-Fi network and navigate to:
     `http://<ESP32_IP>:81/stream`
   - Verify that the live video stream displays smoothly at 10–15 FPS in SVGA (800x600).

3. **Backend Status & Enclave Telemetry:**
   - Sign in to the PresenceTrack Governance Enclave (`/enclave/admin` or `/enclave/security`).
   - Navigate to the **Edge Nodes** or **Vision Gateway** panel.
   - Confirm that the node `ESP32-CAM-01-NORTH` shows status **ONLINE** with active heartbeats received within the last 15 seconds.
