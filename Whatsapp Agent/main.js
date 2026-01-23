// --- 1. Module Imports ---
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path'); 
const Store = require('electron-store').default;
const { startWsBridge } = require('./ws-client'); 

// --- 2. Configuration & Store ---
// Use a more recent Chrome user agent to bypass WhatsApp Web detection
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Set userData path before creating store (must be before app.whenReady)
// Also set cache paths to prevent access denied errors
const userDataPath = path.join(app.getPath('appData'), 'WhatsApp_Summarizer');
app.setPath('userData', userDataPath);
app.setPath('cache', path.join(userDataPath, 'Cache'));
app.setPath('sessionData', path.join(userDataPath, 'Session Data'));

const store = new Store({
    defaults: {
        globalSettings: {
            isSetupComplete: false,
            recipientPhoneNumber: null, 
            recipientEmail: null,
            llmApiKey: null, 
            twilioAccountSid: null,
            twilioAuthToken: null,
            twilioWhatsAppNumber: null,
            emailSender: null,
            emailHost: null,
            emailPort: 587,
            emailUser: null,
            emailPass: null,
        },
        scheduledChats: [],
        scheduledMessages: []
    }
});

let whatsappWindow = null;
let uiWindow = null;
let automationInterval = null; 
let chatQueue = [];
let currentlyRunningChat = null;

// Helper function to safely check if WhatsApp window is available
function isWhatsAppWindowAvailable() {
    try {
        if (!whatsappWindow) return false;
        if (whatsappWindow.isDestroyed()) return false;
        // Check if webContents exists and is accessible
        // Accessing webContents on a destroyed window can throw
        if (!whatsappWindow.webContents) return false;
        return true;
    } catch (error) {
        // If any error occurs (e.g., accessing destroyed object), window is not available
        return false;
    }
}

// Helper function to safely check if UI window is available
function isUIWindowAvailable() {
    try {
        return uiWindow && !uiWindow.isDestroyed();
    } catch (error) {
        return false;
    }
}

// --- 3. Vercel Backend Integration (FIXED MAPPING) ---
async function callVercelBackend(chatName, messages) {
    const VERCEL_URL = 'https://whatsapp-summary-backend.vercel.app/api/summarize-and-deliver';
    
    const payload = {
        chatName: chatName,
        messages: messages,
        // Match the "recipientInfo" object your Vercel code expects
        recipientInfo: {
            recipientPhoneNumber: store.get('globalSettings.recipientPhoneNumber'),
            recipientEmail: store.get('globalSettings.recipientEmail')
        }
    };

    console.log(`[Network] Sending to Vercel for ${chatName}. Target: ${payload.recipientInfo.recipientPhoneNumber}`);

    try {
        const response = await fetch(VERCEL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Server Error ${response.status}');
        return data; 
    } catch (error) {
        console.error('[Network Error]', error.message);
        return { summary: '[Error] ${error.message}', error: true };
    }
}
// --- 4. Window Creation Functions ---
function createWhatsAppWindow() {
    // Configure session to appear more like Chrome
    const ses = session.fromPartition('persist:whatsapp');
    
    // Clear any problematic cache that might cause access errors
    // This helps prevent "Unable to move the cache: Access is denied" errors
    ses.clearCache().catch(err => {
        console.warn('[WhatsApp Window] Cache clear warning (non-critical):', err.message);
    });
    
    // Set user agent for all requests
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = FAKE_USER_AGENT;
        // Add additional headers to appear more like Chrome
        details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
        details.requestHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
        details.requestHeaders['Accept-Encoding'] = 'gzip, deflate, br';
        details.requestHeaders['Sec-Fetch-Site'] = 'none';
        details.requestHeaders['Sec-Fetch-Mode'] = 'navigate';
        details.requestHeaders['Sec-Fetch-User'] = '?1';
        details.requestHeaders['Sec-Fetch-Dest'] = 'document';
        details.requestHeaders['Upgrade-Insecure-Requests'] = '1';
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    const isSetupComplete = store.get('globalSettings.isSetupComplete');
    
    whatsappWindow = new BrowserWindow({
        width: 1200, height: 800, 
        show: !isSetupComplete, // Show immediately on first launch for QR code
        center: true, // Center the window on screen
        autoHideMenuBar: true, // Hide menu bar for cleaner look
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), 
            nodeIntegration: false, contextIsolation: true,
            backgroundThrottling: false, // Critical: Allows DOM operations to work when window is hidden/minimized
            webSecurity: true, // Keep web security enabled for WhatsApp Web
            partition: 'persist:whatsapp', // Use persistent partition for better cache handling
            // Additional settings to bypass WhatsApp Web detection
            plugins: true,
            experimentalFeatures: true
        }
    });
    
    // On first launch, ensure window is not minimized and is on top
    if (!isSetupComplete) {
        whatsappWindow.setAlwaysOnTop(true); // Keep on top until QR is scanned
        whatsappWindow.setSkipTaskbar(false); // Show in taskbar
    }
    
    // Override user agent for the webContents
    whatsappWindow.webContents.setUserAgent(FAKE_USER_AGENT);
    
    // Ensure the window can operate even when hidden
    whatsappWindow.webContents.setBackgroundThrottling(false);
    
    // Handle console messages to suppress non-critical cache errors
    whatsappWindow.webContents.on('console-message', (event, level, message) => {
        // Suppress cache-related error messages that don't affect functionality
        if (message.includes('Unable to move the cache') || 
            message.includes('Unable to create cache') ||
            message.includes('Gpu Cache Creation failed') ||
            message.includes('Failed to delete the database')) {
            // These are non-critical warnings, log at debug level instead
            if (level === 2) { // Error level
                console.debug('[WhatsApp Window] Non-critical cache warning (suppressed):', message);
            }
        }
    });
    
    // Inject anti-detection script on DOMContentLoaded as backup
    whatsappWindow.webContents.once('dom-ready', () => {
        console.log('[WhatsApp Window] DOM ready, injecting anti-detection script as backup...');
        whatsappWindow.webContents.executeJavaScript(`
            (function() {
                // Re-apply critical overrides in case they were reset
                if (navigator.webdriver !== undefined) {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                        configurable: true,
                        enumerable: false
                    });
                }
                if (!window.chrome) {
                    window.chrome = {
                        runtime: {},
                        loadTimes: function() {},
                        csi: function() {},
                        app: {}
                    };
                }
                console.log('[Anti-Detection] Backup script injected on DOM ready');
            })();
        `).catch(err => console.warn('[WhatsApp Window] Error injecting backup script:', err));
    });
    
    // Load WhatsApp Web
    // Note: Anti-detection script is injected via preload.js before page loads
    whatsappWindow.loadURL('https://web.whatsapp.com');
    
    // Add lifecycle handlers to properly handle window destruction
    whatsappWindow.on('closed', () => {
        console.log('[WhatsApp Window] Window closed, setting reference to null');
        whatsappWindow = null;
    });
    
    whatsappWindow.on('close', (event) => {
        console.log('[WhatsApp Window] Window close event triggered');
        // Don't prevent default - allow window to close normally
    });
    
    whatsappWindow.webContents.on('crashed', (event, killed) => {
        console.error('[WhatsApp Window] Renderer process crashed (killed:', killed, ')');
        console.error('[WhatsApp Window] Setting window reference to null');
        whatsappWindow = null;
    });
    
    whatsappWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[WhatsApp Window] Render process gone. Reason:', details.reason);
        console.error('[WhatsApp Window] Exit code:', details.exitCode);
        console.error('[WhatsApp Window] Setting window reference to null');
        whatsappWindow = null;
    });
    
    whatsappWindow.webContents.on('unresponsive', () => {
        console.warn('[WhatsApp Window] Window became unresponsive');
    });
    
    whatsappWindow.webContents.on('responsive', () => {
        console.log('[WhatsApp Window] Window became responsive again');
    });
    
    if (!isSetupComplete) {
        // First launch - ensure window stays visible and focused for QR code
        // Show immediately (already set in BrowserWindow options)
        
        // Show and focus window as soon as it's ready
        whatsappWindow.once('ready-to-show', () => {
            try {
                if (isWhatsAppWindowAvailable()) {
                    whatsappWindow.show();
                    whatsappWindow.focus();
                    whatsappWindow.moveTop(); // Bring to front
                    console.log('[WhatsApp Window] Window shown and focused on ready-to-show');
                }
            } catch (error) {
                console.error('[WhatsApp Window] Error showing/focusing window on ready:', error);
            }
        });
        
        // After page loads, ensure window stays focused and wait for QR code
        whatsappWindow.webContents.once('did-finish-load', () => {
            console.log('[WhatsApp Window] Page finished loading, injecting anti-detection script and waiting for QR code...');
            
            // Inject anti-detection script again after page loads (critical timing)
            whatsappWindow.webContents.executeJavaScript(`
                (function() {
                    // Comprehensive anti-detection re-injection
                    try {
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined,
                            configurable: true,
                            enumerable: false
                        });
                        
                        if (!window.chrome) {
                            window.chrome = {
                                runtime: {},
                                loadTimes: function() {},
                                csi: function() {},
                                app: {}
                            };
                        }
                        
                        Object.defineProperty(navigator, 'vendor', {
                            get: () => 'Google Inc.',
                            configurable: true
                        });
                        
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['en-US', 'en'],
                            configurable: true
                        });
                        
                        console.log('[Anti-Detection] Script re-injected after page load');
                    } catch (e) {
                        console.error('[Anti-Detection] Error re-injecting:', e);
                    }
                })();
            `).catch(err => console.warn('[WhatsApp Window] Error injecting script after load:', err));
            
            // Give WhatsApp Web time to initialize and render QR code
            // Use multiple checks to ensure QR code appears
            let checkCount = 0;
            const maxChecks = 15; // Check up to 15 times (15 seconds total) - increased for slower connections
            
            const checkForQRCode = setInterval(() => {
                checkCount++;
                
                try {
                    if (!isWhatsAppWindowAvailable()) {
                        clearInterval(checkForQRCode);
                        return;
                    }
                    
                    // Ensure window is visible and focused
                    whatsappWindow.show();
                    whatsappWindow.focus();
                    whatsappWindow.moveTop();
                    
                    // Check if QR code has loaded by checking for QR code canvas or image
                    // Also check for error messages that indicate detection
                    whatsappWindow.webContents.executeJavaScript(`
                        (function() {
                            // Check for WhatsApp Web error messages indicating Electron detection
                            const bodyText = document.body ? document.body.textContent : '';
                            if (bodyText.includes('WhatsApp works with Google Chrome') || 
                                bodyText.includes('WhatsApp works with') ||
                                bodyText.includes('not supported')) {
                                console.error('[WhatsApp] Detection error found in page');
                                return { detected: true, error: 'WhatsApp detected Electron' };
                            }
                            
                            // Check for QR code canvas or image elements
                            const qrCanvas = document.querySelector('canvas[aria-label*="QR"], canvas[aria-label*="קוד"], canvas[data-ref]');
                            const qrImg = document.querySelector('img[alt*="QR"], img[alt*="קוד"]');
                            const qrDiv = document.querySelector('div[data-ref]');
                            
                            if (qrCanvas || qrImg || qrDiv) {
                                console.log('[WhatsApp] QR code element found');
                                return { detected: false, qrLoaded: true };
                            }
                            
                            // Check if page has loaded (not showing loading spinner)
                            const loadingSpinner = document.querySelector('[data-testid="default-loading"]');
                            const loadingIndicator = document.querySelector('[role="progressbar"]');
                            
                            // Check if we're stuck on loading
                            if (loadingSpinner || loadingIndicator) {
                                // Still loading, check if it's been too long
                                return { detected: false, qrLoaded: false, stillLoading: true };
                            }
                            
                            // Page loaded but no QR found - might be connected or error
                            const connectedIndicator = document.querySelector('[data-testid="chat"], [aria-label*="Chat"]');
                            if (connectedIndicator) {
                                return { detected: false, qrLoaded: true, connected: true };
                            }
                            
                            return { detected: false, qrLoaded: false };
                        })();
                    `).then((result) => {
                        // Handle result object (could be boolean for backward compatibility or object)
                        const isObject = typeof result === 'object' && result !== null;
                        const qrCodeLoaded = isObject ? (result.qrLoaded || result.connected) : result;
                        const detected = isObject ? result.detected : false;
                        
                        if (detected) {
                            console.error('[WhatsApp Window] WhatsApp Web detected Electron! Error:', result.error);
                            clearInterval(checkForQRCode);
                            // Try to reload with enhanced anti-detection
                            console.log('[WhatsApp Window] Attempting to reload with enhanced anti-detection...');
                            setTimeout(() => {
                                if (isWhatsAppWindowAvailable()) {
                                    whatsappWindow.reload();
                                }
                            }, 2000);
                            return;
                        }
                        
                        if (qrCodeLoaded || checkCount >= maxChecks) {
                            clearInterval(checkForQRCode);
                            if (qrCodeLoaded) {
                                if (isObject && result.connected) {
                                    console.log('[WhatsApp Window] WhatsApp already connected (no QR needed)');
                                } else {
                                    console.log('[WhatsApp Window] QR code detected, window ready for scanning');
                                }
                            } else {
                                console.warn('[WhatsApp Window] Max checks reached. QR code may not be visible. Check console for errors.');
                                // Log current page state for debugging
                                whatsappWindow.webContents.executeJavaScript(`
                                    console.log('[Debug] Page URL:', window.location.href);
                                    console.log('[Debug] Page title:', document.title);
                                    console.log('[Debug] Body content length:', document.body ? document.body.innerHTML.length : 0);
                                    console.log('[Debug] Navigator.webdriver:', navigator.webdriver);
                                    console.log('[Debug] Window.chrome exists:', !!window.chrome);
                                `).catch(() => {});
                            }
                            
                            // Final focus to ensure window is on top
                            if (isWhatsAppWindowAvailable()) {
                                whatsappWindow.show();
                                whatsappWindow.focus();
                                whatsappWindow.moveTop();
                            }
                        }
                    }).catch((error) => {
                        console.warn('[WhatsApp Window] Error checking for QR code:', error);
                        // Continue checking even if script execution fails
                    });
                    
                    // Stop checking after max attempts
                    if (checkCount >= maxChecks) {
                        clearInterval(checkForQRCode);
                    }
                } catch (error) {
                    console.error('[WhatsApp Window] Error in QR code check:', error);
                    clearInterval(checkForQRCode);
                }
            }, 1000); // Check every second
        });
    } else {
        // Setup complete - keep window hidden
        try {
            if (isWhatsAppWindowAvailable()) {
                whatsappWindow.hide();
            }
        } catch (error) {
            console.error('[WhatsApp Window] Error hiding window:', error);
        }
    }
}

function createUIWindow() {
    const isSetupComplete = store.get('globalSettings.isSetupComplete');
    
    uiWindow = new BrowserWindow({
        width: 400, height: 600, title: 'Settings',
        show: true, // Always show UI window
        center: true,
        webPreferences: {
            preload: path.join(__dirname, 'ui-preload.js'), 
            nodeIntegration: false, contextIsolation: true
        }
    });
    
    uiWindow.loadFile('index.html');
    
    // On first launch, keep UI window in front
    if (!isSetupComplete) {
        uiWindow.setAlwaysOnTop(true);
        uiWindow.once('ready-to-show', () => {
            if (isUIWindowAvailable()) {
                uiWindow.show();
                uiWindow.focus();
                uiWindow.moveTop();
            }
        });
        
        // Remove always on top after a delay to allow user interaction
        // But keep it visible and focused
        setTimeout(() => {
            if (isUIWindowAvailable()) {
                uiWindow.setAlwaysOnTop(false);
                // Keep it focused though
                uiWindow.focus();
            }
        }, 5000); // Remove always-on-top after 5 seconds, but window stays visible
    } else {
        // Setup complete - ensure window is shown
        uiWindow.once('ready-to-show', () => {
            if (isUIWindowAvailable()) {
                uiWindow.show();
                uiWindow.focus();
            }
        });
    }
}

// Ensure WhatsApp window exists and is ready for automation
async function ensureWhatsAppWindowExists() {
    if (isWhatsAppWindowAvailable()) {
        return true; // Window exists and is ready
    }
    
    console.log('[WhatsApp Window] Window not available, recreating...');
    console.log('[WhatsApp Window] Current window state - exists:', !!whatsappWindow, 'destroyed:', whatsappWindow ? whatsappWindow.isDestroyed() : 'N/A');
    
    try {
        createWhatsAppWindow();
        
        // Wait for window to be ready (with timeout)
        return new Promise((resolve) => {
            if (!whatsappWindow) {
                console.error('[WhatsApp Window] Failed to create window');
                resolve(false);
                return;
            }
            
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    console.error('[WhatsApp Window] Timeout waiting for window to be ready');
                    resolve(false);
                }
            }, 10000); // 10 second timeout
            
            whatsappWindow.webContents.once('did-finish-load', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    // Give WhatsApp Web a moment to initialize
                    setTimeout(() => {
                        console.log('[WhatsApp Window] Window recreated and ready');
                        resolve(true);
                    }, 2000);
                }
            });
            
            // If window is already loaded
            if (whatsappWindow.webContents.getURL() && whatsappWindow.webContents.getURL() !== 'about:blank') {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    setTimeout(() => {
                        console.log('[WhatsApp Window] Window already loaded, ready');
                        resolve(true);
                    }, 1000);
                }
            }
        });
    } catch (error) {
        console.error('[WhatsApp Window] Error recreating window:', error);
        return false;
    }
}

// --- 5. Automation Scheduling Logic ---
function isTimeToRun(chat) {
    if (!chat.frequency || !chat.time) return false;
    const scheduledHour = parseInt(chat.time.substring(0, 2), 10);
    const scheduledMinute = parseInt(chat.time.substring(3, 5), 10);
    const now = new Date();
    const timeMatch = (now.getHours() === scheduledHour && now.getMinutes() === scheduledMinute);
    const lastRun = new Date(chat.lastRunTime || 0); 
    const hoursSince = (now.getTime() - lastRun.getTime()) / 3600000;

    if (chat.frequency === 'hourly') return now.getMinutes() === scheduledMinute && hoursSince >= 0.9;
    return timeMatch; 
}

function isTimeToSendMessage(scheduledMessage) {
    if (!scheduledMessage.date || !scheduledMessage.time || scheduledMessage.sent) return false;
    
    const now = new Date();
    const scheduledDate = new Date(`${scheduledMessage.date}T${scheduledMessage.time}`);
    
    // Check if date and time match (within the same minute)
    const dateMatch = now.toISOString().split('T')[0] === scheduledMessage.date;
    const scheduledHour = parseInt(scheduledMessage.time.substring(0, 2), 10);
    const scheduledMinute = parseInt(scheduledMessage.time.substring(3, 5), 10);
    const timeMatch = (now.getHours() === scheduledHour && now.getMinutes() === scheduledMinute);
    
    return dateMatch && timeMatch;
}

function startAutomationLoop() {
    if (automationInterval) clearInterval(automationInterval); 
    automationInterval = setInterval(async () => {
        try {
            // Check if window exists before processing
            if (!isWhatsAppWindowAvailable()) {
                console.log('[Automation] WhatsApp window not available, attempting to recreate...');
                const windowReady = await ensureWhatsAppWindowExists();
                if (!windowReady) {
                    console.log('[Automation] Could not recreate window, skipping automation check');
                    return;
                }
            }
            const chatsToRun = store.get('scheduledChats').filter(chat => isTimeToRun(chat));
            if (chatsToRun.length > 0) await processChatQueue(chatsToRun);
            
            // Check scheduled messages
            const messages = store.get('scheduledMessages') || [];
            const messagesToSend = messages.filter(msg => isTimeToSendMessage(msg));
            if (messagesToSend.length > 0) {
                for (const message of messagesToSend) {
                    await processScheduledMessage(message);
                }
            }
        } catch (error) {
            console.error('[Automation] Error in automation loop:', error);
        }
    }, 60000); 
}

async function processChatQueue(chats) {
    try {
        // Ensure window exists before processing
        const windowReady = await ensureWhatsAppWindowExists();
        if (!windowReady) {
            console.log('[Automation] WhatsApp window not available, skipping chat queue');
            chatQueue = [];
            currentlyRunningChat = null;
            if (isUIWindowAvailable()) {
                try {
                    uiWindow.webContents.send('main:automation-status', { message: 'Error: Could not access WhatsApp window.' });
                } catch (e) {
                    console.error('[Automation] Error sending status:', e);
                }
            }
            return;
        }
        
        chatQueue = [...chats]; 
        // FIXED: Added quotes
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:automation-status', { message: 'Batch run started.' });
            } catch (e) {
                console.error('[Automation] Error sending status:', e);
            }
        }
        
        // Window can work in background with backgroundThrottling disabled
        // No need to show it - operations work even when hidden
        await processNextChatInQueue();
    } catch (error) {
        console.error('[Automation] Error in processChatQueue:', error);
        chatQueue = [];
        currentlyRunningChat = null;
    }
}

async function processScheduledMessage(message) {
    try {
        // Ensure window exists before processing
        const windowReady = await ensureWhatsAppWindowExists();
        if (!windowReady) {
            console.log('[Automation] WhatsApp window not available for scheduled message');
            return;
        }
        
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:automation-status', { message: `Sending scheduled message to ${message.chatName}...` });
            } catch (e) {
                console.error('[Automation] Error sending status:', e);
            }
        }
        
        // Store the message being sent for later reference
        const messageToSend = { ...message };
        
        // Send command to WhatsApp window to send the message
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('app:command-send-message', {
                chatName: message.chatName,
                messageText: message.message
            });
            
            // Store reference for the response handler
            if (!whatsappWindow._pendingMessage) {
                whatsappWindow._pendingMessage = messageToSend;
            }
        } else {
            throw new Error('Window not available at send time');
        }
    } catch (error) {
        console.error('[Automation] Error in processScheduledMessage:', error);
    }
}

async function processNextChatInQueue() {
    try {
        if (chatQueue.length === 0) {
            if (isUIWindowAvailable()) {
                try {
                    uiWindow.webContents.send('main:automation-status', { message: 'All processed.' });
                } catch (e) {
                    console.error('[Automation] Error sending status:', e);
                }
            }
            currentlyRunningChat = null;
            return;
        }
        
        // Ensure window exists before processing
        const windowReady = await ensureWhatsAppWindowExists();
        if (!windowReady) {
            console.log('[Automation] WhatsApp window destroyed, stopping queue processing');
            chatQueue = []; // Clear queue
            currentlyRunningChat = null;
            if (isUIWindowAvailable()) {
                try {
                    uiWindow.webContents.send('main:automation-status', { message: 'Error: WhatsApp window unavailable.' });
                } catch (e) {
                    console.error('[Automation] Error sending status:', e);
                }
            }
            return;
        }
        
        currentlyRunningChat = chatQueue.shift();
        
        // Double-check window state immediately before sending command
        if (!isWhatsAppWindowAvailable()) {
            console.log('[Automation] Window became unavailable, recreating...');
            const recreated = await ensureWhatsAppWindowExists();
            if (!recreated) {
                console.error('[Automation] Failed to recreate window, skipping chat');
                await processNextChatInQueue();
                return;
            }
        }
        
        // Window can work in background with backgroundThrottling disabled
        // No need to show it - operations work even when hidden
        try {
            // Final check right before sending
            if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
                whatsappWindow.webContents.send('app:command-click-chat', currentlyRunningChat.name);
            } else {
                throw new Error('Window not available at send time');
            }
        } catch (error) {
            console.error('[Automation] Error sending command to WhatsApp window:', error);
            // Skip this chat and continue with next
            await processNextChatInQueue();
        }
    } catch (error) {
        console.error('[Automation] Error in processNextChatInQueue:', error);
        chatQueue = [];
        currentlyRunningChat = null;
    }
}

function updateChatLastRunTime() {
    if (!currentlyRunningChat) return;
    const updated = store.get('scheduledChats').map(chat => 
        chat.name === currentlyRunningChat.name ? { ...chat, lastRunTime: new Date().toISOString() } : chat
    );
    store.set('scheduledChats', updated);
}

// --- 6. IPC Listeners ---
ipcMain.on('ui:request-setup-complete-status', (event) => {
    event.sender.send('main:setup-complete-status', store.get('globalSettings.isSetupComplete'));
});

ipcMain.on('ui:save-api-key', (event) => {
    // API key is no longer required, but keep handler for compatibility
    event.sender.send('main:llm-key-saved');
});

ipcMain.on('ui:save-delivery-settings', (event, settings) => {
    // FIXED: Correct backtick interpolation for store keys
    Object.keys(settings).forEach(key => store.set(`globalSettings.${key}`, settings[key]));
    store.set('globalSettings.isSetupComplete', true);
    event.sender.send('main:setup-complete-status', true);
    event.sender.send('main:delivery-settings-saved'); 
});

ipcMain.on('ui:run-delivery-test', async () => {
    const res = await callVercelBackend("Connection Test", [{time: "00:00", sender: "System", text: "Test"}]);
    if (uiWindow) {
        // FIXED: Added quotes and backticks for interpolation
        const msg = res.error ? `❌ Fail: ${res.summary}` : "✅ Success! Server delivered.";
        uiWindow.webContents.send('main:automation-status', { message: msg, isTestResult: true });
    }
});

ipcMain.on('ui:request-chat-list', async () => {
    // Ensure window exists
    const windowReady = await ensureWhatsAppWindowExists();
    if (!windowReady || !isWhatsAppWindowAvailable()) {
        console.error('[IPC] WhatsApp window not available for chat list request');
        return;
    }
    
    // Window can work in background with backgroundThrottling disabled
    // No need to show it - operations work even when hidden
    try {
        // Final check right before sending
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('app:request-chat-list');
        }
    } catch (error) {
        console.error('[IPC] Error sending chat list request:', error);
    }
});

ipcMain.on('ui:save-schedules', (event, schedules) => {
    store.set('scheduledChats', schedules);
    if (!automationInterval) startAutomationLoop();
});

ipcMain.on('ui:request-scheduled-chats', (event) => {
    event.sender.send('main:render-scheduled-chats', store.get('scheduledChats'));
});

ipcMain.on('ui:save-scheduled-message', (event, message) => {
    const messages = store.get('scheduledMessages') || [];
    messages.push(message);
    store.set('scheduledMessages', messages);
    if (!automationInterval) startAutomationLoop();
    // Send updated list back to UI
    if (uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages);
});

ipcMain.on('ui:request-scheduled-messages', (event) => {
    const messages = store.get('scheduledMessages') || [];
    // Filter out sent messages before sending
    const pendingMessages = messages.filter(msg => !msg.sent);
    event.sender.send('main:render-scheduled-messages', pendingMessages);
});

ipcMain.on('ui:delete-scheduled-message', (event, index) => {
    const messages = store.get('scheduledMessages') || [];
    if (index >= 0 && index < messages.length) {
        messages.splice(index, 1);
        store.set('scheduledMessages', messages);
        // Send updated list back to UI
        if (uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(msg => !msg.sent));
    }
});

ipcMain.on('ui:edit-scheduled-message', (event, { index, message }) => {
    const messages = store.get('scheduledMessages') || [];
    if (index >= 0 && index < messages.length) {
        messages[index] = message;
        store.set('scheduledMessages', messages);
        // Send updated list back to UI
        if (uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(msg => !msg.sent));
    }
});

ipcMain.on('ui:request-chat-list-for-message', (event) => {
    if (!isWhatsAppWindowAvailable()) {
        console.error('[IPC] WhatsApp window not available for chat list request');
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list', []);
        return;
    }
    
    try {
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('app:request-chat-list');
        }
    } catch (error) {
        console.error('[IPC] Error requesting chat list for message:', error);
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list', []);
    }
});

ipcMain.on('ui:toggle-whatsapp-window', async () => {
    const windowReady = await ensureWhatsAppWindowExists();
    if (!windowReady || !isWhatsAppWindowAvailable()) {
        console.error('[IPC] WhatsApp window not available for toggle');
        return;
    }
    
    try {
        // Final check right before operation
        if (isWhatsAppWindowAvailable() && whatsappWindow) {
            if (whatsappWindow.isVisible()) {
                whatsappWindow.hide();
            } else {
                whatsappWindow.show();
                whatsappWindow.focus();
            }
        }
    } catch (error) {
        console.error('[IPC] Error toggling WhatsApp window:', error);
    }
});

ipcMain.on('ui:open-whatsapp-window', async () => {
    const windowReady = await ensureWhatsAppWindowExists();
    if (!windowReady || !isWhatsAppWindowAvailable()) {
        console.error('[IPC] WhatsApp window not available for open');
        return;
    }
    
    try {
        // Final check right before operation
        if (isWhatsAppWindowAvailable() && whatsappWindow) {
            whatsappWindow.show();
            whatsappWindow.focus();
        }
    } catch (error) {
        console.error('[IPC] Error opening WhatsApp window:', error);
    }
});

ipcMain.on('ui:auto-hide-whatsapp', async () => {
    if (!isWhatsAppWindowAvailable()) return;
    
    try {
        // Final check right before operation
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.isVisible()) {
            whatsappWindow.hide();
        }
    } catch (error) {
        console.error('[IPC] Error hiding WhatsApp window:', error);
    }
});

// --- 7. WhatsApp Scraper Handlers ---
ipcMain.on('whatsapp:ready', (event) => {
    // Notify UI that WhatsApp is connected
    if (isUIWindowAvailable()) {
        try {
            uiWindow.webContents.send('main:whatsapp-status', 'connected');
        } catch (error) {
            console.error('[IPC] Error sending WhatsApp ready status:', error);
        }
    }
    
    const isSetupComplete = store.get('globalSettings.isSetupComplete');
    
    // On first launch, hide WhatsApp window and proceed to delivery setup
    if (!isSetupComplete) {
        // Hide the WhatsApp window after connection
        if (isWhatsAppWindowAvailable()) {
            try {
                whatsappWindow.setAlwaysOnTop(false); // Remove always on top after connection
                whatsappWindow.hide();
            } catch (error) {
                console.error('[WhatsApp] Error hiding window after connection:', error);
            }
        }
        // Notify UI to proceed to delivery setup
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:whatsapp-connected-first-launch');
            } catch (error) {
                console.error('[IPC] Error sending first launch notification:', error);
            }
        }
    } else {
        // Already set up, request chat list if needed
        event.sender.send('app:request-chat-list');
    }
});

ipcMain.on('whatsapp:response-chat-list', (event, list) => {
    if (uiWindow) uiWindow.webContents.send('main:render-chat-list', list);
});

ipcMain.on('whatsapp:chat-opened', (event) => {
    event.sender.send('app:request-messages');
});

ipcMain.on('whatsapp:request-native-click', (event, { x, y, name }) => {
    event.sender.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    event.sender.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    ipcMain.emit('whatsapp:chat-opened', event, name); 
});
ipcMain.on('ui:request-delivery-settings', (event) => {
    const settings = store.get('globalSettings');
    console.log('[Store] Sending saved settings to UI:', settings.recipientPhoneNumber);
    event.sender.send('main:render-delivery-settings', settings);
});

ipcMain.on('whatsapp:message-sent', async (event, { chatName, success, error }) => {
    if (success) {
        console.log(`[Automation] Scheduled message sent successfully to ${chatName}`);
        
        // Mark message as sent and remove from store
        // Find messages for this chat that haven't been sent yet
        // Since we process one at a time, we can safely remove the first unsent message for this chat
        const messages = store.get('scheduledMessages') || [];
        let messageRemoved = false;
        const updatedMessages = messages.filter(msg => {
            // Remove the first unsent message matching this chatName
            if (!messageRemoved && msg.chatName === chatName && msg.sent === false) {
                messageRemoved = true;
                return false; // Remove this message
            }
            return true; // Keep all other messages
        });
        store.set('scheduledMessages', updatedMessages);
        
        // Update UI
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:automation-status', { message: `Scheduled message sent to ${chatName}` });
                uiWindow.webContents.send('main:render-scheduled-messages', updatedMessages.filter(msg => !msg.sent));
            } catch (e) {
                console.error('[Automation] Error sending status:', e);
            }
        }
    } else {
        console.error(`[Automation] Failed to send scheduled message to ${chatName}:`, error);
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:automation-status', { message: `Failed to send message to ${chatName}: ${error}` });
            } catch (e) {
                console.error('[Automation] Error sending status:', e);
            }
        }
    }
});

ipcMain.on('whatsapp:response-messages', async (event, messages) => {
    if (!currentlyRunningChat) return;
    updateChatLastRunTime();
    // FIXED: Added quotes
    if (isUIWindowAvailable()) {
        try {
            uiWindow.webContents.send('main:automation-status', { message: "Summarizing..." });
        } catch (error) {
            console.error('[IPC] Error sending automation status:', error);
        }
    }

    const result = await callVercelBackend(currentlyRunningChat.name, messages);

    if (isUIWindowAvailable()) {
        try {
            uiWindow.webContents.send('main:render-summary', { 
                chatName: currentlyRunningChat.name, 
                summary: result.summary, 
                frequency: currentlyRunningChat.frequency, 
                time: currentlyRunningChat.time 
            });
        } catch (error) {
            console.error('[IPC] Error sending summary:', error);
        }
    }
    // Check if window still exists before scheduling next chat
    if (isWhatsAppWindowAvailable()) {
        setTimeout(async () => {
            try {
                // Ensure window exists before processing next chat
                const windowReady = await ensureWhatsAppWindowExists();
                if (windowReady && isWhatsAppWindowAvailable()) {
                    await processNextChatInQueue();
                } else {
                    console.log('[Automation] WhatsApp window destroyed during wait, stopping automation');
                    chatQueue = [];
                    currentlyRunningChat = null;
                }
            } catch (error) {
                console.error('[Automation] Error in setTimeout callback:', error);
                chatQueue = [];
                currentlyRunningChat = null;
            }
        }, 3000);
    } else {
        console.log('[Automation] WhatsApp window destroyed, stopping automation');
        chatQueue = [];
        currentlyRunningChat = null;
    } 
});

// --- 8. App Lifecycle ---
app.whenReady().then(() => {
    // Create UI window first so it appears on top
    createUIWindow();
    
    // Small delay to ensure UI window is ready, then create WhatsApp window
    setTimeout(() => {
        createWhatsAppWindow();
        
        // Notify UI that WhatsApp is connecting
        setTimeout(() => {
            if (isUIWindowAvailable()) {
                try {
                    uiWindow.webContents.send('main:whatsapp-status', 'connecting');
                } catch (error) {
                    console.error('[App] Error sending WhatsApp status:', error);
                }
            }
        }, 500);
    }, 300);
    
    if (store.get('globalSettings.isSetupComplete')) startAutomationLoop();
    startWsBridge(store);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });