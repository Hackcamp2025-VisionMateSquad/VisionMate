document.addEventListener('DOMContentLoaded', () => {
    
    // --- STATE & MOCK DATA ---
    const state = {
        currentPage: 'dashboard',
        alarms: {
            smoke: true,
            fall: false,
        },
        videoOnline: false, // Will be set by the *real* video script
        webcamStream: null, // Holds the active webcam stream
        detectionLoopId: null, // Holds the ID for requestAnimationFrame
        isModelLoading: false, // Prevents multiple load attempts
        // User-defined safe zones
        safeZones: [
            { name: "Home", radius: 50, locationName: "Home" },
            { name: "Office", radius: 100, locationName: "Office" },
            { name: "Community Center", radius: 150, locationName: "Community Center" },
        ],
        // Base simulation data
        simulatedLocations: [
            { name: "Home", detail: "Living Room" },
            { name: "Home", detail: "Kitchen" },
            { name: "Office", detail: "Main Desk" },
            { name: "Community Center", detail: "Lobby" },
            { name: "Unknown", detail: "Moving..." }
        ],
        currentLocationIndex: 0,
        newZoneLocation: null,
    };

    let cocoModel = null; // Holds the loaded COCO-SSD model

    // --- UI SELECTORS (from File 1) ---
    const pageTitle = document.getElementById('page-title');
    const pages = document.querySelectorAll('.page-content');
    const navLinks = document.querySelectorAll('.nav-link');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

    // Modals
    const sosModal = document.getElementById('sos-modal');
    const sosButton = document.getElementById('sos-button');
    const confirmSos = document.getElementById('confirm-sos');
    const cancelSos = document.getElementById('cancel-sos');

    const speakModal = document.getElementById('speak-modal');
    const speakButton = document.getElementById('speak-button');
    const sendSpeak = document.getElementById('send-speak');
    const cancelSpeak = document.getElementById('cancel-speak');
    const speakMessageTextarea = document.getElementById('speak-message');

    const zonesModal = document.getElementById('zones-modal');
    const manageZonesButton = document.getElementById('manage-zones-button');
    const cancelZones = document.getElementById('cancel-zones');
    const addZoneBtn = document.getElementById('add-zone-btn');
    const zoneNameInput = document.getElementById('zone-name');
    const zoneRadiusInput = document.getElementById('zone-radius');
    const safeZoneList = document.getElementById('safe-zone-list');
    const setLocationCurrentBtn = document.getElementById('set-location-current');
    const setLocationMapBtn = document.getElementById('set-location-map');
    const newZoneLocationStatus = document.getElementById('new-zone-location-status');

    // Dashboard Elements
    const activityLog = document.getElementById('activity-log');
    const dashboardAqi = document.getElementById('dashboard-aqi');
    const dashboardAqiLarge = document.getElementById('dashboard-aqi-large');
    const dashboardLocationStatus = document.getElementById('dashboard-location-status');
    const dashboardLocationDetail = document.getElementById('dashboard-location-detail');
    const dashboardVideoStatus = document.getElementById('dashboard-video-status');

    // Video Page Elements
    const videoStatusBadge = document.getElementById('video-status-badge');
    const videoStatusText = document.getElementById('video-status-text');
    const videoPlaceholder = document.getElementById('video-placeholder');

    // Health Page Elements
    const healthAqi = document.getElementById('health-aqi');

    // Location Page Elements
    const locationPageStatus = document.getElementById('location-page-status');
    const locationPageDetail = document.getElementById('location-page-detail');
    const locationLastUpdated = document.getElementById('location-last-updated');

    // Alarm Page Elements
    const toggleButtons = document.querySelectorAll('.toggle-btn');
    const alarmLog = document.getElementById('alarm-log');

    // --- UI SELECTORS (from File 2) ---
    const video = document.getElementById('webcam'); // The <video> element
    const canvas = document.getElementById('canvas'); // The <canvas> element
    const log = document.getElementById('log'); // The debug log <ul>
    const statusText = videoStatusText; // Re-use the existing UI element
    const ctx = canvas.getContext('2d');

    // --- CONFIGURATION (from File 2) ---
    const TARGET_CLASSES = new Set([
        'person',
        'chair',
        'car',
        'stop sign',
        'dining table',
        'bench',
        'sofa'
    ]);
    const CONFIDENCE_THRESHOLD = 0.5;


    // --- NAVIGATION ---
    function showPage(pageId) {
        // --- MODIFIED: Stop webcam if we are leaving the video page ---
        if (state.currentPage === 'video' && pageId !== 'video') {
            stopVideoDetection();
        }

        // Hide all pages
        pages.forEach(page => page.classList.add('hidden'));
        
        // Show the target page
        const targetPage = document.getElementById(`${pageId}-page`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
        }

        // Update page title
        const pageName = pageId.charAt(0).toUpperCase() + pageId.slice(1);
        pageTitle.textContent = pageName;

        // Update active link
        updateNavLinks(pageId);
        
        state.currentPage = pageId;

        // --- MODIFIED: Start webcam if we are entering the video page ---
        if (pageId === 'video') {
            startVideoDetection();
        }
    }

    function updateNavLinks(activePageId) {
        // ... (This function is unchanged) ...
        navLinks.forEach(link => {
            if (link.dataset.page === activePageId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
        mobileNavLinks.forEach(link => {
            if (link.dataset.page === activePageId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    [...navLinks, ...mobileNavLinks].forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.dataset.page;
            if (pageId) {
                showPage(pageId);
            }
        });
    });

    // --- MODAL HANDLING ---
    // ... (All modal functions: SOS, Speak, Safe Zones are unchanged) ...
    
    // SOS Modal
    sosButton.addEventListener('click', () => sosModal.classList.remove('hidden'));
    cancelSos.addEventListener('click', () => sosModal.classList.add('hidden'));
    confirmSos.addEventListener('click', () => {
        logActivity('SOS Triggered', 'Manual SOS alert initiated.', 'red');
        sosModal.classList.add('hidden');
    });

    // Speak Modal
    speakButton.addEventListener('click', () => speakModal.classList.remove('hidden'));
    cancelSpeak.addEventListener('click', () => {
        speakModal.classList.add('hidden');
        speakMessageTextarea.value = '';
    });
    sendSpeak.addEventListener('click', () => {
        logActivity('Message Sent', `Sent audio: "${speakMessageTextarea.value}"`, 'cyan');
        speakModal.classList.add('hidden');
        speakMessageTextarea.value = '';
    });

    // Safe Zones Modal
    if (manageZonesButton) {
        manageZonesButton.addEventListener('click', () => {
            zonesModal.classList.remove('hidden');
            resetZoneForm();
            renderSafeZones();
        });
    }
    cancelZones.addEventListener('click', () => zonesModal.classList.add('hidden'));


    // --- SAFE ZONE MANAGEMENT ---
    // ... (All safe zone functions: resetZoneForm, renderSafeZones, etc. are unchanged) ...
    
    function resetZoneForm() {
        zoneNameInput.value = '';
        zoneRadiusInput.value = '';
        state.newZoneLocation = null;
        newZoneLocationStatus.textContent = 'Location: (Not set)';
        newZoneLocationStatus.classList.remove('text-green-400');
        newZoneLocationStatus.classList.add('text-gray-500');
    }
    function renderSafeZones() {
        if (!safeZoneList) return;
        safeZoneList.innerHTML = ''; 
        if (state.safeZones.length === 0) {
            safeZoneList.innerHTML = `<li class="text-sm text-gray-500">No safe zones added.</li>`;
            return;
        }
        state.safeZones.forEach((zone, index) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-3 bg-gray-700 rounded-lg';
            li.innerHTML = `
                <div>
                    <span class="font-medium text-white">${zone.name}</span>
                    <span class="ml-2 text-sm text-gray-400">(Radius: ${zone.radius}m)</span>
                </div>
                <div>
                    <button class="text-sm text-blue-400 hover:text-blue-300 mr-3 edit-zone-btn" data-index="${index}">Edit</button>
                    <button class="text-sm text-red-500 hover:text-red-400 remove-zone-btn" data-index="${index}">Remove</button>
                </div>
            `;
            safeZoneList.appendChild(li);
        });
        addRemoveZoneListeners();
    }
    function addRemoveZoneListeners() {
        document.querySelectorAll('.remove-zone-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index, 10);
                removeSafeZone(index);
            });
        });
        document.querySelectorAll('.edit-zone-btn').forEach(button => {
            button.addEventListener('click', () => {
                alert('Editing is not yet implemented.');
            });
        });
    }
    function removeSafeZone(index) {
        state.safeZones.splice(index, 1);
        renderSafeZones();
    }
    function addSafeZone() {
        const newName = zoneNameInput.value.trim();
        const newRadius = parseInt(zoneRadiusInput.value.trim(), 10);
        if (!newName) {
            alert("Please enter a zone name.");
            return;
        }
        if (isNaN(newRadius) || newRadius <= 0) {
            alert("Please enter a valid radius (e.g., 50).");
            return;
        }
        if (!state.newZoneLocation) {
            alert("Please set a location using the 'Use Current Location' button.");
            return;
        }
        if (state.safeZones.some(zone => zone.name.toLowerCase() === newName.toLowerCase())) {
            alert("A zone with this name already exists.");
            return;
        }
        state.safeZones.push({ 
            name: newName, 
            radius: newRadius, 
            locationName: state.newZoneLocation.name
        });
        resetZoneForm();
        renderSafeZones();
    }
    if (addZoneBtn) {
        addZoneBtn.addEventListener('click', addSafeZone);
    }
    if (setLocationCurrentBtn) {
        setLocationCurrentBtn.addEventListener('click', () => {
            const currentLocation = state.simulatedLocations[state.currentLocationIndex];
            if (currentLocation.name === "Unknown") {
                alert("Cannot set a Safe Zone for an 'Unknown' location. Please wait for a clear location.");
                return;
            }
            state.newZoneLocation = currentLocation;
            newZoneLocationStatus.textContent = `Location Set: ${currentLocation.name}`;
            newZoneLocationStatus.classList.remove('text-gray-500');
            newZoneLocationStatus.classList.add('text-green-400');
            if (!zoneNameInput.value.trim()) {
                zoneNameInput.value = currentLocation.name;
            }
            if (!zoneRadiusInput.value.trim()) {
                zoneRadiusInput.value = 50;
            }
        });
    }

    // --- ACTIVITY LOGGING ---
    // ... (This function is unchanged) ...
    function logActivity(title, message, iconColor = 'gray') {
        const icons = {
            red: `
                <svg class="w-5 h-5 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>`,
            yellow: `
                <svg class="w-5 h-5 text-yellow-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                     <path stroke-linecap="round" stroke-linejoin="round" d="M12 3.75a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM12 18.75a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM5.036 6.31a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM16.714 18.97a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM18.97 6.31a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM5.036 16.714a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM9.5 12a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM7.096 7.096a.75.75 0 011.06 0l1.061 1.061a.75.75 0 01-1.06 1.06l-1.061-1.06a.75.75 0 010-1.061zM15.843 15.843a.75.75 0 011.06 0l1.061 1.061a.75.75 0 01-1.06 1.06l-1.061-1.06a.75.75 0 010-1.061z" />
                </svg>`,
            cyan: `
                <svg class="w-5 h-5 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-B.75 3h9M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                </svg>`,
            gray: `
                <svg class="w-5 h-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 15.75l-2.489-2.489m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.774 4.774zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>`,
        };
        const iconBg = {
            red: 'bg-red-200',
            yellow: 'bg-yellow-200',
            cyan: 'bg-cyan-200',
            gray: 'bg-gray-700'
        }
        const li = document.createElement('li');
        li.className = 'flex items-start';
        li.innerHTML = `
            <div class="flex-shrink-0 p-2 ${iconBg[iconColor]} rounded-full">
                ${icons[iconColor]}
            </div>
            <div class="ml-3">
                <p class="text-sm font-medium text-white">${title}</p>
                <p class="text-sm text-gray-500">${message}</p>
            </div>
            <span class="ml-auto text-sm text-gray-500">Just now</span>
        `;
        activityLog.prepend(li);
        if (activityLog.children.length > 20) {
            activityLog.removeChild(activityLog.lastChild);
        }
        if (title.includes('Alert') || title.includes('Offline')) {
            const alarmLi = li.cloneNode(true);
            alarmLi.querySelector('.ml-auto').remove(); 
            alarmLi.classList.add('p-3', 'bg-gray-700', 'rounded-lg');
            alarmLi.querySelector('.flex-shrink-0').className = `flex-shrink-0 p-2 ${iconBg[iconColor]} rounded-full`;
            alarmLog.prepend(alarmLi);
            if (alarmLog.children.length > 20) {
                alarmLog.removeChild(alarmLog.lastChild);
            }
        }
    }

    // --- ALARM TOGGLES ---
    // ... (This function is unchanged) ...
    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            const alarmName = button.dataset.alarm;
            const isActive = button.classList.toggle('active');
            state.alarms[alarmName] = isActive;
            logActivity(
                `Alarm ${isActive ? 'Enabled' : 'Disabled'}`,
                `${alarmName.charAt(0).toUpperCase() + alarmName.slice(1)} alarm has been ${isActive ? 'armed' : 'disarmed'}.`,
                'gray'
            );
        });
    });

    // --- MOCK DATA SIMULATION ---
    function updateMockData() {
        // 1. Air Quality
        const aqiValue = Math.floor(Math.random() * 20) + 25; // 25-44
        dashboardAqi.textContent = `${aqiValue} AQI`;
        dashboardAqiLarge.textContent = `${aqiValue} AQI`;
        healthAqi.textContent = `${aqiValue} `;
        healthAqi.insertAdjacentHTML('beforeend', '<span class="text-2xl font-normal text-gray-400">AQI</span>');

        // 2. Location
        state.currentLocationIndex = Math.floor(Math.random() * state.simulatedLocations.length);
        const currentLocation = state.simulatedLocations[state.currentLocationIndex];
        const currentSafeZone = state.safeZones.find(zone => zone.locationName === currentLocation.name);
        const status = currentSafeZone ? currentSafeZone.name : "Unknown";
        
        dashboardLocationStatus.textContent = status;
        dashboardLocationDetail.textContent = currentLocation.detail;
        locationPageStatus.textContent = status;
        locationPageDetail.textContent = `Current Status: ${currentLocation.detail}`;
        locationLastUpdated.textContent = 'Just now';
        
        if (status === 'Unknown') {
            locationPageStatus.classList.remove('bg-green-600');
            locationPageStatus.classList.add('bg-yellow-500');
        } else {
            locationPageStatus.classList.add('bg-green-600');
            locationPageStatus.classList.remove('bg-yellow-500');
        }

        // 3. Video Status (REMOVED)
        // This is now handled by the real webcam logic.
        // We still call updateVideoStatusUI() to ensure the dashboard
        // widget stays in sync with the 'state.videoOnline' variable.
        updateVideoStatusUI();


        // 4. Random Smoke Alert
        if (Math.random() < 0.02 && state.alarms.smoke) { // 2% chance
            logActivity('Smoke Alert', 'High particulate matter detected!', 'red');
        }
    }

    // This function now just reads the state
    function updateVideoStatusUI() {
        if (state.videoOnline) {
            dashboardVideoStatus.textContent = 'LIVE';
            videoStatusBadge.innerHTML = `
                <svg class="w-2 h-2 mr-1.5 fill-current" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
                LIVE
            `;
            videoStatusBadge.classList.remove('bg-red-600', 'animate-pulse');
            videoStatusBadge.classList.add('bg-green-600');
            // statusText (videoStatusText) is controlled by the webcam functions
            videoPlaceholder.classList.add('hidden'); // Hide placeholder
            canvas.classList.remove('hidden'); // Show canvas
        } else {
            dashboardVideoStatus.textContent = 'OFFLINE';
            videoStatusBadge.innerHTML = `
                <svg class="w-2 h-2 mr-1.5 fill-current" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
                OFFLINE
            `;
            videoStatusBadge.classList.remove('bg-green-600');
            videoStatusBadge.classList.add('bg-red-600', 'animate-pulse');
            // statusText is controlled by the webcam functions
            videoPlaceholder.classList.remove('hidden'); // Show placeholder
            canvas.classList.add('hidden'); // Hide canvas
        }
    }

    // --- INITIALIZATION ---
    showPage('dashboard');
    updateMockData(); // Initial data load
    setInterval(updateMockData, 5000); // Update data every 5 seconds


    // ——————————————————————————————————————————————————————————
    // --- 📹 WEBCAM & OBJECT DETECTION (Code from File 2) ---
    // ——————————————————————————————————————————————————————————

    /**
     * Logs a message to the on-screen debug log.
     */
    function logMessage(message) {
        if (!log) return;
        console.log(message);
        log.innerHTML = `<div>[${new Date().toLocaleTimeString()}] ${message}</div>` + log.innerHTML;
        // Keep log from getting too long
        if (log.children.length > 10) {
            log.removeChild(log.lastChild);
        }
    }

    /**
     * Main function to start the video detection process.
     * Called by showPage('video').
     */
    async function startVideoDetection() {
        // Don't run if it's already running or loading
        if (state.webcamStream || state.isModelLoading) {
            return;
        }

        state.isModelLoading = true;

        try {
            // Step 1: Load the model if it's not already loaded
            if (!cocoModel) {
                statusText.textContent = "Loading detection model...";
                logMessage("Loading model...");
                cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
                logMessage("Model loaded successfully.");
            }

            // Step 2: Start the webcam
            statusText.textContent = "Requesting webcam access...";
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' },
                audio: false 
            });
            
            state.webcamStream = stream;
            video.srcObject = stream;

            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                // Update UI to LIVE status
                state.videoOnline = true;
                updateVideoStatusUI();
                statusText.textContent = "Webcam active. Running detection...";
                logActivity('Video Feed Online', 'Vest camera reconnected.', 'gray');

                // Step 3: Start the detection loop
                runDetectionLoop();
            };

        } catch (e) {
            console.error("Error starting video detection: ", e);
            statusText.textContent = "Error: Could not start webcam.";
            logMessage(`Error starting video: ${e.message}`);
            state.videoOnline = false;
            updateVideoStatusUI();
            logActivity('Video Feed Error', 'Could not access vest camera.', 'red');
        } finally {
            state.isModelLoading = false;
        }
    }

    /**
     * Stops the webcam and detection loop.
     * Called by showPage() when navigating away from 'video'.
     */
    function stopVideoDetection() {
        // 1. Stop the detection loop
        if (state.detectionLoopId) {
            cancelAnimationFrame(state.detectionLoopId);
            state.detectionLoopId = null;
        }

        // 2. Stop the webcam stream
        if (state.webcamStream) {
            state.webcamStream.getTracks().forEach(track => track.stop());
            state.webcamStream = null;
            video.srcObject = null;
        }

        // 3. Update the UI
        state.videoOnline = false;
        updateVideoStatusUI();
        statusText.textContent = "FEED OFFLINE";
        logActivity('Video Feed Offline', 'Vest camera connection lost.', 'gray');

        // 4. Clear the canvas
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }


    /**
     * The main detection loop. Runs continuously via requestAnimationFrame.
     */
    async function runDetectionLoop() {
        if (!state.webcamStream) return; // Stop if stream is gone

        // 1. Draw the current video frame onto the canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // 2. Run the model on the video frame (not the canvas)
        const predictions = await cocoModel.detect(video);

        // 3. Process the results
        for (const p of predictions) {
            const label = p.class;
            const confidence = p.score;
            
            if (TARGET_CLASSES.has(label) && confidence > CONFIDENCE_THRESHOLD) {
                
                // --- AUDIO FEEDBACK ---
                logMessage(`Found: ${label} (Confidence: ${confidence.toFixed(2)})`);
                
                // --- VISUAL DEBUGGING ---
                const [x, y, width, height] = p.bbox;

                // Set box style
                ctx.strokeStyle = '#10B981'; // Green
                ctx.lineWidth = 2;
                ctx.fillStyle = '#10B981';
                ctx.font = '16px Arial';

                const text = `${label}: ${confidence.toFixed(2)}`;
                
                // Draw the rectangle
                ctx.strokeRect(x, y, width, height);
                
                // Draw the text background
                const textWidth = ctx.measureText(text).width;
                ctx.fillRect(x, y, textWidth + 8, 20);
                
                // Draw the text
                ctx.fillStyle = '#FFFFFF'; // White text
                ctx.fillText(text, x + 4, y + 14); 
            }
        }

        // Call this function again on the next animation frame
        state.detectionLoopId = requestAnimationFrame(runDetectionLoop);
    } 

});