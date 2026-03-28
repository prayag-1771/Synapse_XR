#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>

// ---------------- PIN MAPPING ----------------
// Flex sensors
const int FLEX_THUMB  = 34; // D34
const int FLEX_INDEX  = 35; // D35
const int FLEX_MIDDLE = 32; // D32
const int FLEX_RING   = 33; // D33
const int FLEX_PINKY  = 36; // VP

// FSR sensors
const int FSR_1 = 39; // VN
const int FSR_2 = 25; // D25

// BNO055
Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28);

// ---------------- SETTINGS ----------------
const int NUM_SAMPLES = 10;   // averaging for cleaner readings
const int READ_DELAY_MS = 300;

// ---------------- HELPERS ----------------
int readAverageAnalog(int pin, int samples = NUM_SAMPLES) {
  long total = 0;
  for (int i = 0; i < samples; i++) {
    total += analogRead(pin);
    delay(2);
  }
  return total / samples;
}

void printAnalogStatus(const char* name, int value) {
  Serial.print(name);
  Serial.print(": ");
  Serial.print(value);

  // Rough interpretation
  if (value < 200) {
    Serial.print("  [very low / maybe disconnected]");
  } else if (value < 1000) {
    Serial.print("  [low]");
  } else if (value < 2500) {
    Serial.print("  [medium]");
  } else {
    Serial.print("  [high]");
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("====================================");
  Serial.println("Synapse XR Glove Sensor Test Start");
  Serial.println("====================================");

  // Optional but useful for stable ADC behavior
  analogReadResolution(12); // ESP32 default is 12-bit: 0 to 4095

  // Start I2C for BNO055
  Wire.begin(21, 22);

  if (!bno.begin()) {
    Serial.println("BNO055 NOT detected!");
    Serial.println("Check:");
    Serial.println("- VCC -> 3.3V");
    Serial.println("- GND -> GND");
    Serial.println("- SDA -> D21");
    Serial.println("- SCL -> D22");
  } else {
    Serial.println("BNO055 detected successfully.");
    bno.setExtCrystalUse(true);
  }

  Serial.println();
  Serial.println("Move one finger at a time and watch values change.");
  Serial.println("Press FSRs and check pressure values.");
  Serial.println("Rotate glove and check IMU values.");
  Serial.println();
}

void loop() {
  // -------- Read flex sensors --------
  int thumb  = readAverageAnalog(FLEX_THUMB);
  int index  = readAverageAnalog(FLEX_INDEX);
  int middle = readAverageAnalog(FLEX_MIDDLE);
  int ring   = readAverageAnalog(FLEX_RING);
  int pinky  = readAverageAnalog(FLEX_PINKY);

  // -------- Read FSRs --------
  int fsr1 = readAverageAnalog(FSR_1);
  int fsr2 = readAverageAnalog(FSR_2);

  // -------- Print analog values --------
  Serial.println("----- FLEX SENSORS -----");
  printAnalogStatus("Thumb ", thumb);
  printAnalogStatus("Index ", index);
  printAnalogStatus("Middle", middle);
  printAnalogStatus("Ring  ", ring);
  printAnalogStatus("Pinky ", pinky);

  Serial.println("----- FSR SENSORS ------");
  printAnalogStatus("FSR1  ", fsr1);
  printAnalogStatus("FSR2  ", fsr2);

  // -------- Read BNO055 --------
  if (bno.begin()) {
    imu::Vector<3> euler = bno.getVector(Adafruit_BNO055::VECTOR_EULER);

    Serial.println("-------- IMU -----------");
    Serial.print("Heading: ");
    Serial.println(euler.x());
    Serial.print("Roll   : ");
    Serial.println(euler.z());
    Serial.print("Pitch  : ");
    Serial.println(euler.y());
  } else {
    Serial.println("-------- IMU -----------");
    Serial.println("BNO055 not available");
  }

  Serial.println("==============================");
  delay(READ_DELAY_MS);
}