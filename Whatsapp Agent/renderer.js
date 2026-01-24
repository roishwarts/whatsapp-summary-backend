/**
 * renderer.js: FIXED with Single-Chat Edit, LLM Key Back Button
 */

// --- State (Global Variables) ---
let availableChatNames = [];
let selectedChatNames = new Set();
let scheduledChats = [];           
let existingScheduledChats = []; 
let existingScheduledMessages = [];
let isTestRunning = false; 


// --- 1. Helpers ---

/**
 * Finds a chat in the existingScheduledChats array by name.
 * @param {string} name 
 * @returns {object|undefined}
 */
function findExistingSchedule(name) {
    return existingScheduledChats.find(chat => chat.name === name);
}

/**
 * Renders a simple loading screen
 */
function renderLoadingState() {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2>Loading Application...</h2>
            <p>Checking login status and configuration.</p>
        </div>
    `;
}

/**
 * Renders a loading screen with progress bar for chat list loading
 */
function renderChatListLoadingState() {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2>Loading Your Chats...</h2>
            <p>Searching through your WhatsApp chats. This may take a few seconds...</p>
            <div class="progress-bar-container">
                <div class="progress-bar" id="chat-list-progress-bar"></div>
            </div>
            <p class="loading-text" id="chat-list-loading-text">Initializing...</p>
        </div>
    `;
    
    // Animate progress bar slowly and smoothly
    let progress = 0;
    const progressBar = document.getElementById('chat-list-progress-bar');
    const loadingText = document.getElementById('chat-list-loading-text');
    
    const progressInterval = setInterval(() => {
        if (progress < 90) {
            // Increment slowly: 0.5% to 1.5% per interval for smooth progress
            progress += 0.5 + (Math.random() * 1.0);
            if (progress > 90) progress = 90;
            progressBar.style.width = progress + '%';
            
            // Update loading text based on progress
            if (progress < 25) {
                loadingText.textContent = 'Connecting to WhatsApp...';
            } else if (progress < 50) {
                loadingText.textContent = 'Scanning chat list...';
            } else if (progress < 75) {
                loadingText.textContent = 'Collecting chat names...';
            } else {
                loadingText.textContent = 'Finalizing...';
            }
        }
    }, 200); // Check every 200ms for smoother animation
    
    // Store interval ID so we can clear it when done
    window.chatListLoadingInterval = progressInterval;
}


// --- 2. UI Step - Onboarding Screen (First Launch Only) ---
function renderOnboardingScreen() {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    mainSetupDiv.innerHTML = `
        <div class="status-box" style="text-align: center; padding: 40px 20px;">
            <h2 style="font-size: 28px; margin-bottom: 20px;">Hello 👋</h2>
            <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px; color: #666;">
                Please scan the QR code to connect to WhatsApp.<br>
                After that, you can minimize this window and enjoy your daily brief directly in WhatsApp.
            </p>
            <div style="margin-top: 30px; padding: 20px; background-color: #f5f5f5; border-radius: 8px;">
                <p style="color: #666; font-size: 14px;">
                    The QR code will appear in the WhatsApp window. Once connected, this window will automatically hide.
                </p>
            </div>
        </div>
    `;
}


// --- 3. UI Step - Delivery Configuration (UPDATED) ---
// Helper function to update WhatsApp status indicator
function updateWhatsAppStatus(status) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    
    if (!statusIndicator || !statusText) return;
    
    // Remove all classes
    statusIndicator.className = 'status-dot';
    
    if (status === 'connecting') {
        statusIndicator.innerHTML = '<span class="status-loader"></span>';
        statusText.textContent = 'Connecting...';
    } else if (status === 'connected') {
        statusIndicator.className = 'status-dot connected';
        statusIndicator.innerHTML = '';
        statusText.textContent = 'Connected';
    } else if (status === 'disconnected') {
        statusIndicator.className = 'status-dot disconnected';
        statusIndicator.innerHTML = '';
        statusText.textContent = 'Disconnected';
    }
}

function renderDeliverySetup(isInitialSetup = true) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    isTestRunning = false; 

    // Simplified delivery setup - only phone number
    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2>⚙️ Settings</h2>
            <p>Please enter your phone number</p>
            <input type="text" id="recipient-phone-number" placeholder="+972..." />
            <div id="delivery-status-message" class="status-message" style="margin-top: 10px; color: red;"></div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button id="back-to-dashboard-btn" class="secondary-button" style="flex: 1;">← Back to Dashboard</button>
                <button id="save-delivery-settings-button" class="primary-button" style="flex: 2;">Save Settings</button>
            </div>
        </div>
    `;
    
    const saveButton = document.getElementById('save-delivery-settings-button');
    const statusMessage = document.getElementById('delivery-status-message');
    const backButton = document.getElementById('back-to-dashboard-btn');

    // Back button handler
    backButton.addEventListener('click', () => {
        renderDashboard(existingScheduledChats);
    });
    
    // Load existing phone number if editing
    if (!isInitialSetup) {
        window.uiApi.sendData('ui:request-delivery-settings');
    }
    
    saveButton.addEventListener('click', () => {
        // Collect only phone number
        const recipientPhoneNumber = document.getElementById('recipient-phone-number').value.trim();
        
        if (!recipientPhoneNumber) {
            alert('Please enter your phone number.');
            return;
        }

        // Send simplified settings (only phone number, keep other fields empty/default)
        const settings = {
            twilioAccountSid: '',
            twilioAuthToken: '',
            twilioWhatsAppNumber: '',
            recipientPhoneNumber: recipientPhoneNumber,
            recipientEmail: '',
            emailSender: '',
            emailHost: '',
            emailPort: '587',
            emailUser: '',
            emailPass: '',
        };

        // Send data to main process
        window.uiApi.sendData('ui:save-delivery-settings', settings);
        statusMessage.textContent = 'Settings saved.';
        statusMessage.style.color = 'green';
        
        setTimeout(() => {
            if (!isInitialSetup) {
                renderDashboard(existingScheduledChats);
            } else {
                renderLoadingState();
            }
        }, 1000);
    });
}

// --- 4. UI Step - Chat Selection (Unchanged) ---
function handleChatClick(chatName) {
    const chatButton = document.getElementById(`chat-btn-${chatName}`);
    
    if (selectedChatNames.has(chatName)) {
        selectedChatNames.delete(chatName);
        if (chatButton) chatButton.classList.remove('selected');
        console.log('Deselected chat:', chatName, 'Total selected:', selectedChatNames.size);
    } else {
        selectedChatNames.add(chatName);
        if (chatButton) chatButton.classList.add('selected');
        console.log('Selected chat:', chatName, 'Total selected:', selectedChatNames.size);
    }

    const nextButton = document.getElementById('next-button');
    if (nextButton) {
        nextButton.disabled = selectedChatNames.size === 0;
        console.log('Next button disabled:', nextButton.disabled);
    }
}


function renderChatSelection(chatList) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    const isSetupComplete = existingScheduledChats.length > 0;
    
    selectedChatNames.clear();
    // Pre-select all currently scheduled chats
    existingScheduledChats.forEach(chat => {
        selectedChatNames.add(chat.name);
    });
    
    if (!chatList || chatList.length === 0) {
        mainSetupDiv.innerHTML = `
            <div class="status-box">
                <h2>❌ No Chats Found</h2>
                <p>
                    Please ensure you are logged into WhatsApp Web in the secondary window. 
                    If this is a new login, please wait for the chat list to fully load and try again.
                </p>
                
                <div style="margin-top: 20px; display: flex; gap: 10px;">
                    <button onclick="window.uiApi.sendData('ui:toggle-whatsapp-window')" class="secondary-button">Show WhatsApp Window</button>
                    <button id="retry-chat-list" class="primary-button">Retry Finding Chats</button>
                    ${isSetupComplete ? '<button id="back-to-dashboard-if-setup" class="secondary-button">Back to Dashboard</button>' : ''}
                </div>
            </div>
        `;
        
        document.getElementById('retry-chat-list').addEventListener('click', () => {
            renderLoadingState();
            window.uiApi.sendData('ui:request-chat-list'); 
        });

        if (isSetupComplete) {
            document.getElementById('back-to-dashboard-if-setup').addEventListener('click', () => {
                renderDashboard(existingScheduledChats);
            });
        }
        
        return;
    }

    mainSetupDiv.innerHTML = `
        <div class="setup-header">
            <h2>Select Chats for Daily Brief</h2>
            ${isSetupComplete ? '<button id="back-to-dashboard-btn" class="secondary-button">← Back to Dashboard</button>' : ''}
        </div>
        <p>Click on the chats you want to schedule for daily brief. Selected chats have a green background. Unselecting a chat will remove its schedule.</p>
        <div style="margin: 15px 0;">
            <input type="text" id="chat-search-input" placeholder="🔍 Search chats..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container"></div>
        <button id="next-button" class="primary-button" ${selectedChatNames.size === 0 ? 'disabled' : ''}>Next: Configure Schedules</button>
    `;
    
    const container = document.getElementById('chat-list-container');
    const nextButton = document.getElementById('next-button');
    const searchInput = document.getElementById('chat-search-input');
    
    // Store all chats for filtering
    const allChats = [...chatList];
    
    // Function to render filtered chats
    function renderFilteredChats(filterText = '') {
        container.innerHTML = '';
        const filterLower = filterText.toLowerCase().trim();
        const filteredChats = filterText ? allChats.filter(name => name.toLowerCase().includes(filterLower)) : allChats;
        
        if (filteredChats.length === 0) {
            container.innerHTML = '<p style="color: #666; padding: 20px; text-align: center;">No chats match your search.</p>';
            return;
        }
        
        filteredChats.forEach(name => {
            const chatElement = document.createElement('button');
            chatElement.id = `chat-btn-${name}`;
            chatElement.className = 'chat-button';
            chatElement.textContent = name;
            
            if (selectedChatNames.has(name)) {
                chatElement.classList.add('selected');
            }

            chatElement.addEventListener('click', () => {
                handleChatClick(name); 
            });
            
            container.appendChild(chatElement);
        });
    }
    
    // Initial render
    renderFilteredChats();
    
    // Add search functionality
    searchInput.addEventListener('input', (e) => {
        renderFilteredChats(e.target.value);
    });

    nextButton.addEventListener('click', () => {
        // Get current selected chats (in case of any timing issues)
        const selectedArray = Array.from(selectedChatNames);
        console.log('Next button clicked. Selected chats:', selectedArray);
        
        if (selectedArray.length > 0) {
            renderScheduling(selectedArray);
        } else {
            alert('Please select at least one chat to schedule.');
        }
    });
    
    if (isSetupComplete) {
        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
            renderDashboard(existingScheduledChats);
        });
    }

    window.uiApi.sendData('ui:auto-hide-whatsapp');
}


// --- 5. UI Step - Scheduling (The Third Step for mass changes) (Unchanged) ---

function renderScheduling(chatsToSchedule) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    console.log('renderScheduling called with chats:', chatsToSchedule);
    
    // Ensure chatsToSchedule is an array and not empty
    if (!chatsToSchedule || chatsToSchedule.length === 0) {
        console.error('No chats provided to renderScheduling');
        alert('No chats selected. Please go back and select at least one chat.');
        return;
    }

    // Filter to keep only selected chats, but merge with existing schedules
    scheduledChats = chatsToSchedule.map(name => {
        const existing = findExistingSchedule(name) || { frequency: 'daily', time: '08:00', lastRunTime: null };
        return { name, ...existing, frequency: 'daily' }; // Always use 'daily'
    });

    console.log('Scheduled chats after mapping:', scheduledChats);
    scheduledChats.sort((a, b) => a.name.localeCompare(b.name));

    mainSetupDiv.innerHTML = `
        <div class="setup-header">
            <h2>Set Daily Brief Schedules</h2>
            <button id="back-to-dashboard-btn" class="secondary-button">← Back to Dashboard</button>
        </div>
        <p>Set the time for the daily brief to be generated for each chat.</p>
        <div id="schedule-container"></div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button" class="secondary-button" style="flex: 1;">← Back to Chat Selection</button>
            <button id="save-schedules-button" class="primary-button" style="flex: 1;">Save & Start Automation</button>
        </div>
    `;
    
    const container = document.getElementById('schedule-container');
    
    if (scheduledChats.length === 0) {
        container.innerHTML = '<p style="color: #666; padding: 20px;">No chats to schedule. Please go back and select chats.</p>';
        return;
    }

    scheduledChats.forEach(chat => {
        console.log('Rendering schedule for chat:', chat.name);
        const scheduleItem = document.createElement('div');
        scheduleItem.className = 'schedule-item';
        
        // Escape special characters in chat name for use in IDs (but keep original name for display)
        const safeId = chat.name.replace(/[^a-zA-Z0-9]/g, '_');
        
        scheduleItem.innerHTML = `
            <h4>${chat.name}</h4>
            <div class="schedule-controls">
                <input type="time" id="time-${safeId}" data-name="${chat.name}" value="${chat.time}">
            </div>
        `;
        
        // Always set frequency to 'daily'
        chat.frequency = 'daily';
        
        container.appendChild(scheduleItem);
    });
    
    const controls = container.querySelectorAll('input[type="time"]');
    controls.forEach(control => {
        control.addEventListener('change', (e) => {
            const chatName = e.target.dataset.name;
            const chat = scheduledChats.find(c => c.name === chatName);
            if (!chat) {
                console.error('Chat not found for control change:', chatName);
                return;
            }

            if (e.target.type === 'time') {
                chat.time = e.target.value;
                chat.frequency = 'daily'; // Always set to daily
            }
            console.log('Updated chat schedule:', chat);
        });
    });

    document.getElementById('back-button').addEventListener('click', () => {
        renderChatSelection(availableChatNames);
    });

    // Add back to dashboard button handler
    const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            window.uiApi.sendData('ui:request-scheduled-chats');
        });
    }

    document.getElementById('save-schedules-button').addEventListener('click', () => {
        // Filter out any chats that were unselected in the previous step (i.e., those not in existingScheduledChats)
        // Ensure all chats have frequency set to 'daily'
        const finalSchedules = scheduledChats
            .filter(chat => chatsToSchedule.includes(chat.name))
            .map(chat => ({ ...chat, frequency: 'daily' }));
        window.uiApi.sendData('ui:save-schedules', finalSchedules);
        renderDashboard(finalSchedules);
    });
}


// --- 6. UI Step - Dedicated Single Chat Editing (NEW) ---

function editSingleChatSchedule(chatName) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    const chatToEdit = existingScheduledChats.find(chat => chat.name === chatName);
    if (!chatToEdit) {
         alert(`Error: Schedule for ${chatName} not found.`);
         renderDashboard(existingScheduledChats);
         return;
    }

    // Clone the chat object for local editing state
    let chat = { ...chatToEdit }; 

    mainSetupDiv.innerHTML = `
        <h2>✏️ Edit Schedule for: ${chatName}</h2>
        <p>Adjust the time for the daily brief for this chat.</p>
        <div id="schedule-container"></div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button" class="secondary-button" style="flex: 1;">← Back to Dashboard</button>
            <button id="save-schedules-button" class="primary-button" style="flex: 1;">Save Schedule</button>
        </div>
    `;

    const container = document.getElementById('schedule-container');
    
    // Render the single schedule item
    const scheduleItem = document.createElement('div');
    scheduleItem.className = 'schedule-item';
    scheduleItem.style.borderBottom = 'none'; // No need for dashed line on a single item

    // Escape special characters in chat name for use in IDs (but keep original name for display)
    const safeId = chat.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    scheduleItem.innerHTML = `
        <div class="schedule-controls" style="width: 100%; display: flex; justify-content: flex-end;">
            <input type="time" id="time-${safeId}" data-name="${chat.name}" value="${chat.time}">
        </div>
    `;
    
    // Always set frequency to 'daily'
    chat.frequency = 'daily';
    
    container.appendChild(scheduleItem);

    // Add change listeners
    const controls = container.querySelectorAll('input[type="time"]');
    console.log('Edit schedule - Found controls:', controls.length);
    controls.forEach(control => {
        console.log('Control:', control.id, control.tagName, control.type);
        control.addEventListener('change', (e) => {
            console.log('Control changed:', e.target.id, e.target.value);
            if (e.target.type === 'time') {
                chat.time = e.target.value;
                chat.frequency = 'daily'; // Always set to daily
                console.log('Updated time to:', chat.time);
            }
        });
        
        // Also add input event for time input to catch changes immediately
        control.addEventListener('input', (e) => {
            chat.time = e.target.value;
            chat.frequency = 'daily'; // Always set to daily
            console.log('Time input changed to:', chat.time);
        });
    });

    // Back to Dashboard logic
    document.getElementById('back-button').addEventListener('click', () => {
        // Just rerender the dashboard with the current (unsaved) existing chats
        renderDashboard(existingScheduledChats); 
    });

    // Save logic
    document.getElementById('save-schedules-button').addEventListener('click', () => {
        // Update the main list before saving only the changes for this one chat
        // Ensure frequency is always 'daily'
        const updatedChats = existingScheduledChats.map(existingChat => {
            if (existingChat.name === chat.name) {
                // Return the locally modified chat object with frequency set to 'daily'
                return { ...chat, frequency: 'daily' }; 
            }
            return { ...existingChat, frequency: 'daily' };
        });
        
        window.uiApi.sendData('ui:save-schedules', updatedChats);
        renderDashboard(updatedChats); // Rerender dashboard with updated list
    });
}

// --- 6.5. UI Step - Scheduled Message Flow ---

function renderScheduledMessageChatSelection(chatList) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    selectedChatNames.clear();
    
    if (!chatList || chatList.length === 0) {
        mainSetupDiv.innerHTML = `
            <div class="status-box">
                <h2>❌ No Chats Found</h2>
                <p>
                    Please ensure you are logged into WhatsApp Web in the secondary window. 
                    If this is a new login, please wait for the chat list to fully load and try again.
                </p>
                
                <div style="margin-top: 20px; display: flex; gap: 10px;">
                    <button onclick="window.uiApi.sendData('ui:toggle-whatsapp-window')" class="secondary-button">Show WhatsApp Window</button>
                    <button id="retry-chat-list" class="primary-button">Retry Finding Chats</button>
                    <button id="back-to-dashboard-btn" class="secondary-button">Back to Dashboard</button>
                </div>
            </div>
        `;
        
        document.getElementById('retry-chat-list').addEventListener('click', () => {
            renderChatListLoadingState();
            window.uiApi.sendData('ui:request-chat-list-for-message'); 
        });

        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
            window.uiApi.sendData('ui:request-scheduled-messages');
        });
        
        return;
    }

    mainSetupDiv.innerHTML = `
        <div class="setup-header">
            <h2>Choose to who you want to send the message</h2>
            <button id="back-to-dashboard-btn" class="secondary-button">← Back to Dashboard</button>
        </div>
        <p>Click on the chat you want to send a scheduled message to.</p>
        <div style="margin: 15px 0;">
            <input type="text" id="chat-search-input" placeholder="🔍 Search chats..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container"></div>
        <button id="next-button" class="primary-button" disabled>Next: Configure when to send the message</button>
    `;
    
    const container = document.getElementById('chat-list-container');
    const nextButton = document.getElementById('next-button');
    const searchInput = document.getElementById('chat-search-input');
    
    const allChats = [...chatList];
    let selectedChatName = null;
    
    function renderFilteredChats(filterText = '') {
        container.innerHTML = '';
        const filterLower = filterText.toLowerCase().trim();
        const filteredChats = filterText ? allChats.filter(name => name.toLowerCase().includes(filterLower)) : allChats;
        
        if (filteredChats.length === 0) {
            container.innerHTML = '<p style="color: #666; padding: 20px; text-align: center;">No chats match your search.</p>';
            return;
        }
        
        filteredChats.forEach(name => {
            const chatElement = document.createElement('button');
            chatElement.id = `chat-btn-${name}`;
            chatElement.className = 'chat-button';
            chatElement.textContent = name;
            
            if (selectedChatName === name) {
                chatElement.classList.add('selected');
            }

            chatElement.addEventListener('click', () => {
                // Deselect previous selection
                if (selectedChatName) {
                    const prevButton = document.getElementById(`chat-btn-${selectedChatName}`);
                    if (prevButton) prevButton.classList.remove('selected');
                }
                
                // Select new chat
                selectedChatName = name;
                chatElement.classList.add('selected');
                nextButton.disabled = false;
            });
            
            container.appendChild(chatElement);
        });
    }
    
    renderFilteredChats();
    
    searchInput.addEventListener('input', (e) => {
        renderFilteredChats(e.target.value);
    });

    nextButton.addEventListener('click', () => {
        if (selectedChatName) {
            renderScheduledMessageTimeSelection(selectedChatName);
        } else {
            alert('Please select a chat to send the message to.');
        }
    });
    
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
        window.uiApi.sendData('ui:request-scheduled-messages');
    });

    window.uiApi.sendData('ui:auto-hide-whatsapp');
}

function renderScheduledMessageTimeSelection(chatName, existingDate = null, existingTime = null, existingMessage = null, editIndex = null) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    // Default to today's date and current time + 1 hour
    const now = new Date();
    const defaultDate = existingDate || now.toISOString().split('T')[0];
    const defaultHour = existingTime ? existingTime.substring(0, 2) : String((now.getHours() + 1) % 24).padStart(2, '0');
    const defaultMinute = existingTime ? existingTime.substring(3, 5) : String(now.getMinutes()).padStart(2, '0');
    const defaultTime = existingTime || `${defaultHour}:${defaultMinute}`;

    mainSetupDiv.innerHTML = `
        <div class="setup-header">
            <h2>Configure when to send the message</h2>
            <button id="back-to-dashboard-btn" class="secondary-button">← Back to Dashboard</button>
        </div>
        <p>Select the date and time when you want to send the message to <strong>${chatName}</strong>.</p>
        <div id="time-selection-container" style="margin: 20px 0;">
            <div style="margin-bottom: 15px;">
                <label for="message-date" style="display: block; margin-bottom: 5px; font-weight: bold;">Date:</label>
                <input type="date" id="message-date" value="${defaultDate}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
            <div style="margin-bottom: 15px;">
                <label for="message-time" style="display: block; margin-bottom: 5px; font-weight: bold;">Time:</label>
                <input type="time" id="message-time" value="${defaultTime}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button-bottom" class="secondary-button" style="flex: 1;">← Back</button>
            <button id="next-button" class="primary-button" style="flex: 1;">Next</button>
        </div>
    `;

    const dateInput = document.getElementById('message-date');
    const timeInput = document.getElementById('message-time');
    const nextButton = document.getElementById('next-button');
    const backButtonBottom = document.getElementById('back-button-bottom');

    const handleNext = () => {
        const selectedDate = dateInput.value;
        const selectedTime = timeInput.value;
        
        if (!selectedDate || !selectedTime) {
            alert('Please select both date and time.');
            return;
        }

        // Validate that selected date/time is in the future
        const selectedDateTime = new Date(`${selectedDate}T${selectedTime}`);
        const now = new Date();
        
        if (selectedDateTime <= now) {
            alert('Please select a date and time in the future.');
            return;
        }

        renderScheduledMessageInput(chatName, selectedDate, selectedTime, existingMessage, editIndex);
    };

    nextButton.addEventListener('click', handleNext);
    
    // Back button - go to previous step (chat selection)
    backButtonBottom.addEventListener('click', () => {
        renderChatListLoadingState();
        window.uiApi.sendData('ui:request-chat-list-for-message');
    });

    // Back to dashboard button handler
    const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            // Request both scheduled chats and messages to render full dashboard
            window.uiApi.sendData('ui:request-scheduled-chats');
        });
    }
}

function renderScheduledMessageInput(chatName, date, time, existingMessage = null, editIndex = null) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;

    mainSetupDiv.innerHTML = `
        <div class="setup-header">
            <h2>Type your message</h2>
            <button id="back-to-dashboard-btn" class="secondary-button">← Back to Dashboard</button>
        </div>
        <p>Enter the message you want to send to <strong>${chatName}</strong> on ${date} at ${time}.</p>
        <div style="margin: 20px 0;">
            <textarea id="message-text" placeholder="Type your message here..." style="width: 100%; min-height: 150px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; font-family: inherit; resize: vertical;">${existingMessage || ''}</textarea>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button-bottom" class="secondary-button" style="flex: 1;">← Back</button>
            <button id="save-button" class="primary-button" style="flex: 1;">Save</button>
        </div>
    `;

    const messageTextarea = document.getElementById('message-text');
    const saveButton = document.getElementById('save-button');
    const backButtonBottom = document.getElementById('back-button-bottom');

    const handleSave = () => {
        const messageText = messageTextarea.value.trim();
        
        if (!messageText) {
            alert('Please enter a message.');
            return;
        }

        const scheduledMessage = {
            chatName: chatName,
            message: messageText,
            date: date,
            time: time,
            sent: false
        };

        if (editIndex !== null) {
            // Editing existing message
            window.uiApi.sendData('ui:edit-scheduled-message', { index: editIndex, message: scheduledMessage });
        } else {
            // Creating new message
            window.uiApi.sendData('ui:save-scheduled-message', scheduledMessage);
        }
        
        // Return to dashboard after saving
        setTimeout(() => {
            window.uiApi.sendData('ui:request-scheduled-messages');
        }, 100);
    };

    saveButton.addEventListener('click', handleSave);
    
    // Back button - go to previous step (time selection)
    backButtonBottom.addEventListener('click', () => {
        renderScheduledMessageTimeSelection(chatName, date, time, existingMessage, editIndex);
    });

    // Back to dashboard button handler
    const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            // Request both scheduled chats and messages to render full dashboard
            window.uiApi.sendData('ui:request-scheduled-chats');
        });
    }
}


// --- 7. UI Step - Dashboard (Final State) (FIXED Edit button listener) ---

function renderDashboard(currentSchedules) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    existingScheduledChats = currentSchedules;
    
    // Get current WhatsApp connection status
    const whatsappStatus = window.whatsappConnectionStatus || 'connecting'; // 'connecting', 'connected', 'disconnected'

    mainSetupDiv.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>WhatsApp Assistant</h2>
            </div>
            <div class="dashboard-header-right">
                <div id="whatsapp-status-indicator" class="whatsapp-status">
                    <span id="status-indicator"></span>
                    <span id="status-text">Connecting...</span>
                </div>
                <button id="toggle-whatsapp-button" class="header-button" title="Show/Hide WhatsApp">Show/Hide WhatsApp</button>
                <button id="settings-icon-button" class="settings-icon" title="Settings">⚙️</button>
            </div>
        </div>
        
        <div id="dashboard-controls" style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button id="add-chat-button" class="primary-button" style="flex: 1;">+ Add a scheduled daily brief</button>
            <button id="add-scheduled-message-button" class="primary-button" style="flex: 1;">+ Add a scheduled message</button>
        </div>

        <div id="scheduled-messages-container" style="margin-bottom: 30px;">
            <h3>Scheduled Messages:</h3>
            <ul id="scheduled-messages-ul"></ul>
        </div>

        <div id="schedule-list-container">
            <h3>Scheduled Daily Briefs:</h3>
            <ul id="schedules-ul"></ul>
        </div>
    `;
    
    // Update WhatsApp status indicator
    updateWhatsAppStatus(whatsappStatus);

    // Populate scheduled messages list
    const messagesUl = document.getElementById('scheduled-messages-ul');
    if (existingScheduledMessages.length === 0) {
        messagesUl.innerHTML = '<li><p class="status-message">No messages are currently scheduled.</p></li>';
    } else {
        messagesUl.innerHTML = '';
        existingScheduledMessages.forEach((msg, index) => {
            if (msg.sent) return; // Skip sent messages
            const li = document.createElement('li');
            const messagePreview = msg.message.length > 50 ? msg.message.substring(0, 50) + '...' : msg.message;
            const dateTime = `${msg.date} at ${msg.time}`;
            li.innerHTML = `
                <div class="schedule-item-dashboard">
                    <div style="flex: 1;">
                        <strong>${msg.chatName}</strong> <span style="color: #666; font-weight: normal;">${dateTime}</span>
                        <p style="color: #888; font-size: 12px; margin: 5px 0 0 0;">${messagePreview}</p>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="edit-message-button secondary-button" data-message-index="${index}" title="Edit message">✏️</button>
                        <button class="delete-message-button secondary-button" data-message-index="${index}" title="Delete message">🗑️</button>
                    </div>
                </div>
            `;
            messagesUl.appendChild(li);
        });
    }

    // Populate schedules list
    const ul = document.getElementById('schedules-ul');
    if (currentSchedules.length === 0) {
        ul.innerHTML = '<li><p class="status-message">No chats are currently scheduled.</p></li>';
    } else {
        currentSchedules.forEach(chat => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="schedule-item-dashboard">
                    <div style="flex: 1;">
                        <strong>${chat.name}</strong> <span style="color: #666; font-weight: normal;">at ${chat.time}</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="edit-chat-button secondary-button" data-chat-name="${chat.name}" title="Edit schedule">✏️</button>
                        <button class="delete-chat-button secondary-button" data-chat-name="${chat.name}" title="Remove from schedule">🗑️</button>
                    </div>
                </div>
                <p class="small-text last-run">Last Run: ${chat.lastRunTime ? new Date(chat.lastRunTime).toLocaleString() : 'Never'}</p>
            `;
            ul.appendChild(li);
        });
    }
    
    
    // Add dashboard control listeners
    document.getElementById('toggle-whatsapp-button').addEventListener('click', () => {
        window.uiApi.sendData('ui:toggle-whatsapp-window');
    });

    document.getElementById('add-chat-button').addEventListener('click', () => {
        renderChatListLoadingState();
        window.uiApi.sendData('ui:request-chat-list'); 
    });

    document.getElementById('add-scheduled-message-button').addEventListener('click', () => {
        renderChatListLoadingState();
        window.uiApi.sendData('ui:request-chat-list-for-message'); 
    });
    
    document.getElementById('settings-icon-button').addEventListener('click', () => {
        renderDeliverySetup(false);
    });

    // FIX: Individual Edit button now goes to the dedicated single-chat editor
    document.querySelectorAll('.edit-chat-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const chatName = e.currentTarget.dataset.chatName;
            editSingleChatSchedule(chatName); 
        });
    });
    
    // Add delete button handlers
    document.querySelectorAll('.delete-chat-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const chatName = e.currentTarget.dataset.chatName;
            if (confirm(`Are you sure you want to remove "${chatName}" from the schedule?`)) {
                // Remove the chat from schedules
                const updatedSchedules = existingScheduledChats.filter(chat => chat.name !== chatName);
                window.uiApi.sendData('ui:save-schedules', updatedSchedules);
                renderDashboard(updatedSchedules);
            }
        });
    });

    // Add edit/delete handlers for scheduled messages
    document.querySelectorAll('.edit-message-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.messageIndex);
            const message = existingScheduledMessages[index];
            if (message) {
                renderScheduledMessageTimeSelection(message.chatName, message.date, message.time, message.message, index);
            }
        });
    });

    document.querySelectorAll('.delete-message-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.messageIndex);
            const message = existingScheduledMessages[index];
            if (message && confirm(`Are you sure you want to delete the scheduled message to "${message.chatName}"?`)) {
                window.uiApi.sendData('ui:delete-scheduled-message', index);
            }
        });
    });
}


// --- 8. IPC Listeners (Main Process Communication) (Unchanged) ---

function initializeIPCListeners() {
    
    // 1. Receive LLM Key saved status (no longer used, but kept for compatibility)
    window.uiApi.receiveCommand('main:llm-key-saved', () => {
        // If we came from the edit flow, we go back to dashboard
        if (existingScheduledChats.length > 0) {
            window.uiApi.sendData('ui:request-scheduled-chats');
        } else {
            // Otherwise, continue to delivery setup (initial flow)
            renderDeliverySetup(true); 
        }
    });
    
    // New: Handle WhatsApp connection on first launch
    window.uiApi.receiveCommand('main:whatsapp-connected-first-launch', () => {
        // WhatsApp is connected on first launch, proceed to delivery setup
        renderDeliverySetup(true);
    });

    // 2. Confirmation that delivery settings were saved (used during Edit flow and Test)
    window.uiApi.receiveCommand('main:delivery-settings-saved', () => {
        const statusMessageElement = document.getElementById('delivery-status-message');
        const testButton = document.getElementById('test-delivery-button');
        
        // Show temporary success message
        if (statusMessageElement) {
            statusMessageElement.textContent = 'Settings saved successfully!';
        }
        
        // If not running a test, navigate back to dashboard immediately
        if (!isTestRunning) {
            setTimeout(() => { 
                if (statusMessageElement) statusMessageElement.textContent = ''; // Clear message
                window.uiApi.sendData('ui:request-scheduled-chats'); 
            }, 1000); 
        } 
    });

    // 3. Receive Delivery Settings (for pre-populating inputs when editing)
    window.uiApi.receiveCommand('main:render-delivery-settings', (settings) => {
        const phoneInput = document.getElementById('recipient-phone-number');
        if (phoneInput) {
            phoneInput.value = settings.recipientPhoneNumber || '';
        }
    });
    
    // 9. Receive WhatsApp connection status updates
    window.uiApi.receiveCommand('main:whatsapp-status', (status) => {
        window.whatsappConnectionStatus = status;
        updateWhatsAppStatus(status);
    });

    // 4. Receive FULL Setup Status from Main 
    window.uiApi.receiveCommand('main:setup-complete-status', (isComplete) => {
        if (isComplete) {
            window.uiApi.sendData('ui:request-scheduled-chats');
        } else {
            // First launch - show onboarding screen instead of API key
            renderOnboardingScreen();
        }
    });
    
    // 5. Receive the existing scheduled chats (for dashboard rendering)
    window.uiApi.receiveCommand('main:render-scheduled-chats', (chats) => {
        existingScheduledChats = chats;
        // Also request scheduled messages to render both
        window.uiApi.sendData('ui:request-scheduled-messages');
    });
    
    // 5.5. Receive the existing scheduled messages (for dashboard rendering)
    window.uiApi.receiveCommand('main:render-scheduled-messages', (messages) => {
        existingScheduledMessages = messages || [];
        // Re-render dashboard with both chats and messages
        renderDashboard(existingScheduledChats);
    });

    // 6. Receive the list of chats from the WhatsApp window (Triggers selection screen)
    window.uiApi.receiveCommand('main:render-chat-list', (chatList) => {
        // Complete the progress bar animation
        if (window.chatListLoadingInterval) {
            clearInterval(window.chatListLoadingInterval);
            window.chatListLoadingInterval = null;
        }
        const progressBar = document.getElementById('chat-list-progress-bar');
        const loadingText = document.getElementById('chat-list-loading-text');
        if (progressBar) {
            progressBar.style.width = '100%';
        }
        if (loadingText) {
            loadingText.textContent = 'Complete!';
        }
        
        // Small delay to show completion, then render chat selection
        setTimeout(() => {
            availableChatNames = chatList;
            window.currentFlow = null; // Reset flow
            renderChatSelection(availableChatNames);
        }, 300);
    });

    // 6.5. Receive the list of chats for scheduled message flow
    window.uiApi.receiveCommand('main:render-chat-list-for-message', (chatList) => {
        // Complete the progress bar animation
        if (window.chatListLoadingInterval) {
            clearInterval(window.chatListLoadingInterval);
            window.chatListLoadingInterval = null;
        }
        const progressBar = document.getElementById('chat-list-progress-bar');
        const loadingText = document.getElementById('chat-list-loading-text');
        if (progressBar) {
            progressBar.style.width = '100%';
        }
        if (loadingText) {
            loadingText.textContent = 'Complete!';
        }
        
        // Small delay to show completion, then render scheduled message chat selection
        setTimeout(() => {
            renderScheduledMessageChatSelection(chatList);
        }, 300);
    });

    // 7. Automation status updates (for dashboard and test run feedback)
    window.uiApi.receiveCommand('main:automation-status', (statusPayload) => {
        const statusMessageElement = document.getElementById('delivery-status-message');
        const testButton = document.getElementById('test-delivery-button');
        
        if (statusPayload.isTestResult) {
            // This is the result of the Test Delivery button click
            if (statusMessageElement) {
                statusMessageElement.textContent = statusPayload.message;
            }
            if (testButton) {
                testButton.disabled = false;
            }
            
            isTestRunning = false; // Reset flag after displaying results
            
            // Navigate back to dashboard after showing results for a few seconds
            setTimeout(() => {
                window.uiApi.sendData('ui:request-scheduled-chats');
            }, 3000); 
            
        } else if (resultsContainer) {
            // This is a regular automation status update for the dashboard
            if (document.getElementById('dashboard-controls')) {
                 const statusBox = document.createElement('p');
                 statusBox.className = 'status-message';
                 statusBox.textContent = `[${new Date().toLocaleTimeString()}] ${statusPayload.message}`;
            
                 const initialMessage = resultsContainer.querySelector('.status-message');
                 if (initialMessage && initialMessage.textContent.includes('Awaiting first scheduled run')) {
                     initialMessage.remove();
                 }
                 resultsContainer.prepend(statusBox);
            }
        }
    });

    // 8. Receive the final summary (removed - no longer displaying summaries in UI)
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    renderLoadingState();
    initializeIPCListeners();
    
    if (window.uiApi) {
        window.uiApi.sendData('ui:request-setup-complete-status');
        // Also request scheduled messages on load
        window.uiApi.sendData('ui:request-scheduled-messages');
    }
});