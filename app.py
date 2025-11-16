from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import threading
import time

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Global state to store the latest detection data
detection_state = {
    'position': 'STOP',  # Can be: LEFT, RIGHT, CENTER, STOP
    'timestamp': datetime.now().isoformat(),
    'confidence': 0.0,
    'object_detected': False,
    'last_update': None
}

# Lock for thread-safe access
state_lock = threading.Lock()

# Auto-reset timer (stops motors after 2 seconds of no updates)
AUTO_RESET_SECONDS = 2.0

def auto_reset_worker():
    """Background thread to automatically reset to STOP if no updates received"""
    global detection_state
    while True:
        time.sleep(0.5)  # Check every 500ms
        
        with state_lock:
            if detection_state['last_update']:
                time_diff = (datetime.now() - detection_state['last_update']).total_seconds()
                
                # If no update in AUTO_RESET_SECONDS, reset to STOP
                if time_diff > AUTO_RESET_SECONDS and detection_state['position'] != 'STOP':
                    print(f"[AUTO-RESET] No updates for {time_diff:.1f}s - Setting motors to STOP")
                    detection_state['position'] = 'STOP'
                    detection_state['object_detected'] = False
                    detection_state['timestamp'] = datetime.now().isoformat()

# Start auto-reset background thread
reset_thread = threading.Thread(target=auto_reset_worker, daemon=True)
reset_thread.start()

@app.route('/')
def home():
    """Home route - API status"""
    return jsonify({
        'status': 'online',
        'message': 'Accessibility Vest Flask Backend',
        'endpoints': {
            'GET /api/position': 'Get current motor command for ESP32',
            'POST /api/detection': 'Receive detection data from frontend',
            'GET /api/status': 'Get full system status'
        }
    })

@app.route('/api/position', methods=['GET'])
def get_position():
    """
    ESP32 polls this endpoint to get the current motor command
    Returns: JSON with position (LEFT, RIGHT, CENTER, STOP)
    """
    with state_lock:
        return jsonify({
            'position': detection_state['position'],
            'timestamp': detection_state['timestamp'],
            'object_detected': detection_state['object_detected']
        })

@app.route('/api/detection', methods=['POST'])
def update_detection():
    """
    Frontend sends detection data here
    Expected JSON: {
        'position': 'LEFT' | 'RIGHT' | 'CENTER' | 'STOP',
        'confidence': float (0-1),
        'object_detected': boolean
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        position = data.get('position', 'STOP').upper()
        confidence = data.get('confidence', 0.0)
        object_detected = data.get('object_detected', False)
        
        # Validate position
        valid_positions = ['LEFT', 'RIGHT', 'CENTER', 'STOP']
        if position not in valid_positions:
            return jsonify({'error': f'Invalid position. Must be one of: {valid_positions}'}), 400
        
        # Update global state
        with state_lock:
            detection_state['position'] = position
            detection_state['confidence'] = confidence
            detection_state['object_detected'] = object_detected
            detection_state['timestamp'] = datetime.now().isoformat()
            detection_state['last_update'] = datetime.now()
        
        print(f"[UPDATE] Position: {position}, Confidence: {confidence:.2f}, Object: {object_detected}")
        
        return jsonify({
            'success': True,
            'message': 'Detection data updated',
            'current_state': detection_state
        })
    
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/status', methods=['GET'])
def get_status():
    """
    Get complete system status
    """
    with state_lock:
        return jsonify({
            'status': 'running',
            'detection_state': detection_state,
            'auto_reset_enabled': True,
            'auto_reset_seconds': AUTO_RESET_SECONDS
        })

@app.route('/api/manual', methods=['POST'])
def manual_control():
    """
    Manual motor control for testing
    Expected JSON: {'position': 'LEFT' | 'RIGHT' | 'CENTER' | 'STOP'}
    """
    try:
        data = request.get_json()
        position = data.get('position', 'STOP').upper()
        
        valid_positions = ['LEFT', 'RIGHT', 'CENTER', 'STOP']
        if position not in valid_positions:
            return jsonify({'error': f'Invalid position. Must be one of: {valid_positions}'}), 400
        
        with state_lock:
            detection_state['position'] = position
            detection_state['timestamp'] = datetime.now().isoformat()
            detection_state['last_update'] = datetime.now()
            detection_state['object_detected'] = position != 'STOP'
        
        print(f"[MANUAL] Position set to: {position}")
        
        return jsonify({
            'success': True,
            'message': f'Motors set to {position}'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 50)
    print("  Accessibility Vest - Flask Backend Server")
    print("=" * 50)
    print("Server starting on http://localhost:5000")
    print("\nEndpoints:")
    print("  - GET  /api/position   (ESP32 polls this)")
    print("  - POST /api/detection  (Frontend sends here)")
    print("  - GET  /api/status     (System status)")
    print("  - POST /api/manual     (Manual testing)")
    print("\nAuto-reset enabled: Motors stop after 2s of no updates")
    print("=" * 50)
    print()
    
    # Run Flask server
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)