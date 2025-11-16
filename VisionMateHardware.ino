#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ==================== CHANGE THESE! ====================
const char* ssid = "YOUR_WIFI_NAME";           // Your WiFi name
const char* password = "YOUR_WIFI_PASSWORD";   // Your WiFi password
const char* serverUrl = "http://192.168.1.150:5000/api/position";  // Your laptop IP
// =======================================================

// Motor driver pins
const int LEFT_MOTOR_IN1 = 13;
const int LEFT_MOTOR_IN2 = 25;
const int LEFT_MOTOR_PWM = 32;
const int RIGHT_MOTOR_IN1 = 26;
const int RIGHT_MOTOR_IN2 = 27;
const int RIGHT_MOTOR_PWM = 33;
const int MOTOR_STANDBY = 14;
const int MOTOR_SPEED = 200;  // 0-255

// Sensors
const int trigPin = 34;
const int echoPin = 35;
const int buzzerPin = 12;
const int dhtPin = 36;
#define DHTTYPE DHT22
DHT dht(dhtPin, DHTTYPE);

// Variables
const int distanceThreshold = 100;
const int numReadings = 5;
float temperature = 20.0;
float speedOfSound;
int readings[numReadings];
unsigned long lastServerPoll = 0;
const unsigned long serverPollInterval = 500;
String currentMotorState = "STOP";

void setup() {
  Serial.begin(115200);
  
  // Motor pins
  pinMode(LEFT_MOTOR_IN1, OUTPUT);
  pinMode(LEFT_MOTOR_IN2, OUTPUT);
  pinMode(LEFT_MOTOR_PWM, OUTPUT);
  pinMode(RIGHT_MOTOR_IN1, OUTPUT);
  pinMode(RIGHT_MOTOR_IN2, OUTPUT);
  pinMode(RIGHT_MOTOR_PWM, OUTPUT);
  pinMode(MOTOR_STANDBY, OUTPUT);
  digitalWrite(MOTOR_STANDBY, HIGH);
  stopMotors();
  
  // Sensor pins
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  dht.begin();
  
  Serial.println("\n========================================");
  Serial.println("  Accessibility Vest - ESP32");
  Serial.println("========================================");
  
  // Connect WiFi
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Server URL: ");
    Serial.println(serverUrl);
  } else {
    Serial.println("\n✗ WiFi Failed!");
  }
  
  Serial.println("========================================\n");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Poll Flask server
  if (WiFi.status() == WL_CONNECTED && (currentTime - lastServerPoll >= serverPollInterval)) {
    lastServerPoll = currentTime;
    pollFlaskServer();
  }
  
  // Read ultrasonic
  int distance = getDistance();
  
  if (distance > 0 && distance <= distanceThreshold) {
    int beepDelay = map(distance, 0, distanceThreshold, 50, 400);
    digitalWrite(buzzerPin, HIGH);
    delay(beepDelay / 2);
    digitalWrite(buzzerPin, LOW);
    delay(beepDelay / 2);
  } else {
    digitalWrite(buzzerPin, LOW);
    delay(50);
  }
}

void pollFlaskServer() {
  HTTPClient http;
  http.begin(serverUrl);
  http.setTimeout(2000);
  
  int httpCode = http.GET();
  
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    StaticJsonDocument<200> doc;
    
    if (deserializeJson(doc, payload) == DeserializationError::Ok) {
      String position = doc["position"];
      
      if (position != currentMotorState) {
        processMotorCommand(position);
      }
    }
  }
  
  http.end();
}

void processMotorCommand(String cmd) {
  cmd.toUpperCase();
  
  if (cmd == "LEFT") {
    leftMotorOn();
    currentMotorState = "LEFT";
    Serial.println("\n→ LEFT MOTOR ON");
  } else if (cmd == "RIGHT") {
    rightMotorOn();
    currentMotorState = "RIGHT";
    Serial.println("\n→ RIGHT MOTOR ON");
  } else if (cmd == "CENTER") {
    bothMotorsOn();
    currentMotorState = "CENTER";
    Serial.println("\n→ BOTH MOTORS ON");
  } else if (cmd == "STOP") {
    stopMotors();
    currentMotorState = "STOP";
    Serial.println("\n→ MOTORS STOP");
  }
}

void leftMotorOn() {
  digitalWrite(LEFT_MOTOR_IN1, HIGH);
  digitalWrite(LEFT_MOTOR_IN2, LOW);
  analogWrite(LEFT_MOTOR_PWM, MOTOR_SPEED);
  digitalWrite(RIGHT_MOTOR_IN1, LOW);
  digitalWrite(RIGHT_MOTOR_IN2, LOW);
  analogWrite(RIGHT_MOTOR_PWM, 0);
}

void rightMotorOn() {
  digitalWrite(LEFT_MOTOR_IN1, LOW);
  digitalWrite(LEFT_MOTOR_IN2, LOW);
  analogWrite(LEFT_MOTOR_PWM, 0);
  digitalWrite(RIGHT_MOTOR_IN1, HIGH);
  digitalWrite(RIGHT_MOTOR_IN2, LOW);
  analogWrite(RIGHT_MOTOR_PWM, MOTOR_SPEED);
}

void bothMotorsOn() {
  digitalWrite(LEFT_MOTOR_IN1, HIGH);
  digitalWrite(LEFT_MOTOR_IN2, LOW);
  analogWrite(LEFT_MOTOR_PWM, MOTOR_SPEED);
  digitalWrite(RIGHT_MOTOR_IN1, HIGH);
  digitalWrite(RIGHT_MOTOR_IN2, LOW);
  analogWrite(RIGHT_MOTOR_PWM, MOTOR_SPEED);
}

void stopMotors() {
  digitalWrite(LEFT_MOTOR_IN1, LOW);
  digitalWrite(LEFT_MOTOR_IN2, LOW);
  analogWrite(LEFT_MOTOR_PWM, 0);
  digitalWrite(RIGHT_MOTOR_IN1, LOW);
  digitalWrite(RIGHT_MOTOR_IN2, LOW);
  analogWrite(RIGHT_MOTOR_PWM, 0);
}

int getDistance() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  long duration = pulseIn(echoPin, HIGH, 30000);
  if (duration == 0) return -1;
  
  speedOfSound = (331.3 + (0.606 * temperature)) / 10000.0;
  int distance = (duration * speedOfSound) / 2.0;
  return distance;
}
