const { contextBridge, ipcRenderer } = require('electron');

// --- 1. Secure IPC Bridge Setup ---
contextBridge.exposeInMainWorld('whatsappApi', {
    receiveCommand: (channel, listener) => {
        ipcRenderer.on(channel, (event, ...args) => listener(...args));
    },
    sendData: (channel, data) => {
        ipcRenderer.send(channel, data);
    }
});

// --- Anti-Detection Script (Inject before page loads) ---
// This makes Electron appear more like Chrome to bypass WhatsApp Web detection
(function() {
    console.log('[Anti-Detection] Initializing anti-detection script...');
    
    // Override navigator.webdriver (Electron detection) - CRITICAL
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
        enumerable: false
    });
    
    // Override navigator.plugins to appear like Chrome
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [];
            for (let i = 0; i < 5; i++) {
                plugins.push({ 
                    name: 'Chrome PDF Plugin',
                    description: 'Portable Document Format',
                    filename: 'internal-pdf-viewer'
                });
            }
            return plugins;
        },
        configurable: true,
        enumerable: true
    });
    
    // Override navigator.languages to match Chrome
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
        enumerable: true
    });
    
    // Override navigator.language
    Object.defineProperty(navigator, 'language', {
        get: () => 'en-US',
        configurable: true,
        enumerable: true
    });
    
    // Override navigator.vendor to match Chrome
    Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
        configurable: true,
        enumerable: true
    });
    
    // Override navigator.hardwareConcurrency (common Chrome value)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
        enumerable: true
    });
    
    // Override navigator.deviceMemory if available
    if ('deviceMemory' in navigator) {
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
            configurable: true,
            enumerable: true
        });
    }
    
    // Add complete chrome object (WhatsApp Web checks for this extensively)
    if (!window.chrome) {
        window.chrome = {
            runtime: {
                onConnect: undefined,
                onMessage: undefined
            },
            loadTimes: function() {
                return {
                    commitLoadTime: Date.now() / 1000 - Math.random(),
                    finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 0.5,
                    finishLoadTime: Date.now() / 1000 - Math.random() * 0.3,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000 - Math.random() * 0.7,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'unknown',
                    requestTime: Date.now() / 1000 - Math.random() * 2,
                    startLoadTime: Date.now() / 1000 - Math.random() * 2.5,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: false
                };
            },
            csi: function() {
                return {
                    startE: Date.now(),
                    onloadT: Date.now(),
                    pageT: Math.random() * 1000,
                    tran: 15
                };
            },
            app: {
                isInstalled: false,
                InstallState: {
                    DISABLED: 'disabled',
                    INSTALLED: 'installed',
                    NOT_INSTALLED: 'not_installed'
                },
                RunningState: {
                    CANNOT_RUN: 'cannot_run',
                    READY_TO_RUN: 'ready_to_run',
                    RUNNING: 'running'
                }
            }
        };
    }
    
    // Override permissions API
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
                return Promise.resolve({ state: Notification.permission });
            }
            return originalQuery(parameters);
        };
    }
    
    // Override getBattery if available
    if (navigator.getBattery) {
        const originalGetBattery = navigator.getBattery.bind(navigator);
        navigator.getBattery = function() {
            return originalGetBattery().catch(() => {
                // Return a mock battery object if original fails
                return Promise.resolve({
                    charging: true,
                    chargingTime: 0,
                    dischargingTime: Infinity,
                    level: 1.0,
                    addEventListener: function() {},
                    removeEventListener: function() {},
                    dispatchEvent: function() { return true; }
                });
            });
        };
    }
    
    // Remove any Electron-specific properties
    if (window.process && window.process.type) {
        try {
            delete window.process.type;
        } catch (e) {
            // Ignore if can't delete
        }
    }
    
    console.log('[Anti-Detection] Anti-detection script initialized');
})();

// --- 2. Core Interaction Functions (Run in the Renderer/Preload) ---

// Helper function to extract chat name from a row element.
// Prefer the full name from the title attribute (so confirmations show full contact name and disambiguate same first names).
function extractChatNameFromRow(row) {
    // Prefer title attribute (full contact name in WhatsApp Web) so list has full names for confirmation
    let nameElement = row.querySelector('div[role="gridcell"] span[title]');
    if (!nameElement) nameElement = row.querySelector('div[role="gridcell"] div[title]');
    if (!nameElement) nameElement = row.querySelector('span[title]');
    if (!nameElement) nameElement = row.querySelector('div[title]');
    if (nameElement) {
        const fullName = (nameElement.getAttribute('title') || nameElement.textContent || '').trim();
        if (fullName.length > 1) return fullName;
    }
    // Fallback: first line of gridcell textContent (display name, may include emoji e.g. "דור ❤️")
    const gridcell = row.querySelector('div[role="gridcell"]');
    if (gridcell) {
        const cellText = (gridcell.textContent || '').trim();
        const firstLine = cellText.split(/\r?\n/)[0].trim();
        if (firstLine.length > 1) return firstLine;
    }
    return null;
}

// Function 1: Get all chat names from the sidebar (with scrolling to handle virtualization)
async function getChatList() {
    console.log('Scraping chat list...');
    
    // --- Resilient selectors for the main chat list container ---
    const hebrewSelector = '[aria-label="רשימת צ\'אטים"]';
    const englishSelector = '[aria-label="Chat list"]';

    let chatListContainer = document.querySelector(hebrewSelector);
    if (!chatListContainer) {
        chatListContainer = document.querySelector(englishSelector);
    }
    
    if (!chatListContainer) {
        console.error('Error: Main chat list container not found. Check WhatsApp language/login state.');
        return [];
    }
    
    // Find the actual scrollable element (might be nested)
    let scrollableElement = chatListContainer;
    
    // Check if the container itself is scrollable
    const containerScrollHeight = chatListContainer.scrollHeight;
    const containerClientHeight = chatListContainer.clientHeight;
    
    // Try to find a scrollable child element
    const potentialScrollables = chatListContainer.querySelectorAll('div[style*="overflow"], div[style*="scroll"]');
    for (const elem of potentialScrollables) {
        if (elem.scrollHeight > elem.clientHeight) {
            console.log(`Found scrollable child element: scrollHeight=${elem.scrollHeight}, clientHeight=${elem.clientHeight}`);
            scrollableElement = elem;
            break;
        }
    }
    
    // Also check direct children
    for (const child of Array.from(chatListContainer.children)) {
        if (child.scrollHeight > child.clientHeight && child.scrollHeight > containerScrollHeight) {
            console.log(`Found scrollable direct child: scrollHeight=${child.scrollHeight}, clientHeight=${child.clientHeight}`);
            scrollableElement = child;
            break;
        }
    }
    
    const scrollHeight = scrollableElement.scrollHeight;
    const clientHeight = scrollableElement.clientHeight;
    console.log(`Chat list container - scrollHeight: ${containerScrollHeight}px, clientHeight: ${containerClientHeight}px`);
    console.log(`Scrollable element - scrollHeight: ${scrollHeight}px, clientHeight: ${clientHeight}px, scrollable: ${scrollHeight > clientHeight}`);
    
    // Use Set to automatically handle duplicates
    const chatNamesSet = new Set();
    
    // Start at the top
    scrollableElement.scrollTop = 0;
    await new Promise(r => setTimeout(r, 800)); // Wait longer for initial render
    
    // Collect initial visible chats
    let chatRows = chatListContainer.querySelectorAll('[role="row"]');
    chatRows.forEach(row => {
        const name = extractChatNameFromRow(row);
        if (name) {
            chatNamesSet.add(name);
        }
    });
    
    console.log(`Initial visible chats: ${chatNamesSet.size}`);
    
    // Even if it appears not scrollable, try scrolling anyway (WhatsApp virtualization might not report correctly)
    // Systematically scroll through the entire list
    let scrollPosition = 0;
    const scrollStep = 200; // Scroll 200px at a time
    const maxScrolls = 150; // Increased for very long lists (30,000px max)
    let previousCount = chatNamesSet.size;
    let noChangeCount = 0;
    const maxNoChangeCount = 5; // Require 5 consecutive scrolls with no new chats
    
    // Always try scrolling, even if scrollHeight === clientHeight (WhatsApp virtualization can be misleading)
    // The scrollHeight might be incorrect initially, and scrolling can trigger lazy loading
    const shouldTryScrolling = scrollHeight > clientHeight || chatNamesSet.size < 200; // Always scroll if we have fewer than 200 chats
    
    if (!shouldTryScrolling && chatNamesSet.size >= 200) {
        console.log(`Chat list appears complete (${chatNamesSet.size} chats, not scrollable). Returning current list.`);
        return Array.from(chatNamesSet);
    }
    
    if (scrollHeight === clientHeight) {
        console.log(`Warning: scrollHeight === clientHeight (${scrollHeight}px), but only found ${chatNamesSet.size} chats. This might indicate virtualization. Attempting to scroll anyway to trigger lazy loading...`);
    }
    
    console.log(`Starting systematic scroll through chat list (max ${maxScrolls * scrollStep}px)...`);
    
    // Track the maximum scroll position we can actually reach
    let maxReachableScroll = Math.max(0, scrollHeight - clientHeight);
    let initialScrollHeight = scrollHeight;
    let scrollHeightIncreased = false;
    
    // If scrollHeight === clientHeight, try a few scrolls to see if it triggers lazy loading
    if (scrollHeight === clientHeight) {
        console.log('scrollHeight equals clientHeight. Attempting initial scrolls to trigger lazy loading...');
        for (let testScroll = 0; testScroll < 5; testScroll++) {
            scrollableElement.scrollTop = testScroll * 500; // Try larger jumps
            await new Promise(r => setTimeout(r, 800));
            
            const newScrollHeight = scrollableElement.scrollHeight;
            if (newScrollHeight > initialScrollHeight) {
                console.log(`Lazy loading triggered! scrollHeight increased from ${initialScrollHeight}px to ${newScrollHeight}px`);
                scrollHeightIncreased = true;
                maxReachableScroll = newScrollHeight - scrollableElement.clientHeight;
                break;
            }
            
            // Also collect any new chats that appeared
            chatRows = chatListContainer.querySelectorAll('[role="row"]');
            chatRows.forEach(row => {
                const name = extractChatNameFromRow(row);
                if (name) {
                    chatNamesSet.add(name);
                }
            });
        }
        
        // Reset to top after test scrolls
        scrollableElement.scrollTop = 0;
        await new Promise(r => setTimeout(r, 500));
        
        if (!scrollHeightIncreased) {
            console.log('Lazy loading not triggered by initial scrolls. scrollHeight still equals clientHeight.');
            // Continue with normal scrolling anyway - it might still work
        }
    }
    
    while (scrollPosition < maxScrolls * scrollStep && scrollPosition <= maxReachableScroll + 100) {
        // Set scroll position on the scrollable element
        scrollableElement.scrollTop = scrollPosition;
        
        // Wait for WhatsApp to render new chats (virtualization takes time)
        await new Promise(r => setTimeout(r, 500)); // Increased wait time
        
        // Re-check scrollHeight in case it grew (lazy loading)
        const newScrollHeight = scrollableElement.scrollHeight;
        if (newScrollHeight > scrollHeight) {
            console.log(`ScrollHeight increased from ${scrollHeight}px to ${newScrollHeight}px (lazy loading detected)`);
            maxReachableScroll = newScrollHeight - clientHeight;
        }
        
        // Collect chat names from currently visible rows
        chatRows = chatListContainer.querySelectorAll('[role="row"]');
        let newChatsFound = 0;
        
        chatRows.forEach(row => {
            const name = extractChatNameFromRow(row);
            if (name && !chatNamesSet.has(name)) {
                chatNamesSet.add(name);
                newChatsFound++;
            }
        });
        
        const currentCount = chatNamesSet.size;
        const actualScrollTop = scrollableElement.scrollTop;
        
        // Log progress
        if (newChatsFound > 0 || (Math.floor(scrollPosition / scrollStep) % 10 === 0)) {
            console.log(`Scroll ${Math.floor(scrollPosition / scrollStep) + 1} - Position: ${scrollPosition}px, Actual: ${actualScrollTop.toFixed(0)}px, Total chats: ${currentCount} (+${newChatsFound} new)`);
        }
        
        // Check if we've reached the end
        if (currentCount === previousCount && scrollPosition > scrollStep * 2) {
            noChangeCount++;
            if (noChangeCount >= maxNoChangeCount) {
                console.log(`Reached end of chat list (no new chats for ${maxNoChangeCount} consecutive scrolls at ${scrollPosition}px)`);
                break;
            }
        } else {
            noChangeCount = 0;
        }
        previousCount = currentCount;
        
        // Check if scroll was clamped (we're at the end)
        if (Math.abs(actualScrollTop - scrollPosition) > 100 && scrollPosition > scrollStep * 2) {
            console.log(`Scroll position clamped (requested ${scrollPosition}px, got ${actualScrollTop.toFixed(0)}px). Likely at end.`);
            noChangeCount += 2;
        }
        
        // Advance scroll position
        const currentMaxScroll = scrollableElement.scrollHeight - scrollableElement.clientHeight;
        if (Math.abs(actualScrollTop - scrollPosition) < 50) {
            scrollPosition += scrollStep;
        } else {
            // Scroll was clamped, try smaller increment or we're at end
            if (actualScrollTop >= currentMaxScroll - 10) {
                console.log(`Reached bottom of chat list (scrollHeight: ${scrollableElement.scrollHeight}px, maxScroll: ${currentMaxScroll}px)`);
                break;
            }
            scrollPosition = actualScrollTop + scrollStep;
        }
    }
    
    // Try scrolling from bottom up as a final check
    const bottomCheckScrollHeight = scrollableElement.scrollHeight;
    if (bottomCheckScrollHeight > clientHeight) {
        console.log('Final check: Scrolling from bottom up...');
        scrollableElement.scrollTop = bottomCheckScrollHeight;
        await new Promise(r => setTimeout(r, 800));
        
        // Collect any chats we might have missed
        chatRows = chatListContainer.querySelectorAll('[role="row"]');
        let finalNewChats = 0;
        chatRows.forEach(row => {
            const name = extractChatNameFromRow(row);
            if (name && !chatNamesSet.has(name)) {
                chatNamesSet.add(name);
                finalNewChats++;
            }
        });
        
        if (finalNewChats > 0) {
            console.log(`Found ${finalNewChats} additional chats at bottom of list`);
        }
        
        // Also try scrolling up from bottom incrementally
        let bottomScrollPosition = bottomCheckScrollHeight;
        let bottomScrollCount = 0;
        const maxBottomScrolls = 30;
        
        while (bottomScrollPosition > 0 && bottomScrollCount < maxBottomScrolls) {
            bottomScrollPosition = Math.max(0, bottomScrollPosition - scrollStep);
            scrollableElement.scrollTop = bottomScrollPosition;
            await new Promise(r => setTimeout(r, 500));
            
            chatRows = chatListContainer.querySelectorAll('[role="row"]');
            let bottomNewChats = 0;
            chatRows.forEach(row => {
                const name = extractChatNameFromRow(row);
                if (name && !chatNamesSet.has(name)) {
                    chatNamesSet.add(name);
                    bottomNewChats++;
                }
            });
            
            if (bottomNewChats > 0) {
                console.log(`Found ${bottomNewChats} additional chats while scrolling up from bottom (position: ${bottomScrollPosition}px)`);
            }
            
            bottomScrollCount++;
        }
    }
    
    // Final fallback: If scrollHeight never increased and we still have few chats, try scrollIntoView method
    const fallbackScrollHeight = scrollableElement.scrollHeight;
    const fallbackClientHeight = scrollableElement.clientHeight;
    const chatsAfterScrolling = chatNamesSet.size;
    
    if (fallbackScrollHeight === fallbackClientHeight && chatsAfterScrolling < 100 && !scrollHeightIncreased) {
        console.log(`Final fallback: scrollHeight still equals clientHeight after scrolling. Trying scrollIntoView method on all visible rows...`);
        
        // Get all currently visible rows
        const allVisibleRows = Array.from(chatListContainer.querySelectorAll('[role="row"]'));
        console.log(`Found ${allVisibleRows.length} visible rows. Using scrollIntoView to trigger lazy loading...`);
        
        // Try scrolling each row into view to trigger lazy loading
        for (let i = 0; i < allVisibleRows.length; i++) {
            const row = allVisibleRows[i];
            
            // Scroll row into view
            row.scrollIntoView({ behavior: 'auto', block: 'center' });
            await new Promise(r => setTimeout(r, 150)); // Wait for lazy loading
            
            // Re-check scrollHeight - it might have increased
            const currentScrollHeight = scrollableElement.scrollHeight;
            if (currentScrollHeight > fallbackScrollHeight) {
                console.log(`scrollIntoView triggered lazy loading! scrollHeight increased from ${fallbackScrollHeight}px to ${currentScrollHeight}px`);
                // Now that we know it's scrollable, we can continue with the normal scrolling logic above
                // But since we're in a fallback, just collect what we can and continue
                // The main scrolling loop should have already run, so we'll just collect here
            }
            
            // Collect chats after each scrollIntoView
            chatRows = chatListContainer.querySelectorAll('[role="row"]');
            chatRows.forEach(r => {
                const name = extractChatNameFromRow(r);
                if (name) {
                    chatNamesSet.add(name);
                }
            });
            
            // Log progress every 20 rows
            if ((i + 1) % 20 === 0) {
                console.log(`scrollIntoView progress: ${i + 1}/${allVisibleRows.length} rows, ${chatNamesSet.size} unique chats found`);
            }
        }
        
        console.log(`scrollIntoView fallback complete. Found ${chatNamesSet.size} unique chats.`);
    }
    
    const uniqueChatNames = Array.from(chatNamesSet);
    console.log(`Found and filtered ${uniqueChatNames.length} final unique chat names (scrolled through entire list).`);
    return uniqueChatNames;
}

// Helper function to find the WhatsApp search input field
function findSearchInput() {
    // Try multiple selectors for the search input (language-agnostic)
    const selectors = [
        // Common aria-labels for search
        'input[aria-label*="Search"], input[aria-label*="חיפוש"]',
        'div[contenteditable="true"][aria-label*="Search"], div[contenteditable="true"][aria-label*="חיפוש"]',
        // Data attributes
        'div[data-testid="chat-list-search"] input',
        'div[data-testid="chat-list-search"] div[contenteditable="true"]',
        // Structural selectors
        'div[role="textbox"][aria-label*="Search"], div[role="textbox"][aria-label*="חיפוש"]',
        // Fallback: look for search icon and find nearby input
        'div[aria-label*="Search"] input, div[aria-label*="חיפוש"] input',
        'div[aria-label*="Search"] div[contenteditable="true"], div[aria-label*="חיפוש"] div[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            // Verify it's actually a search input (check if it's visible and in the sidebar area)
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                // Check if it's in the left sidebar (search is typically in the first 400px)
                if (rect.left < 400) {
                    console.log(`Found search input using selector: ${selector}`);
                    return el;
                }
            }
        }
    }
    
    return null;
}

// Helper function to clear input field (works for both input and contenteditable)
function clearInputField(element) {
    if (element.tagName === 'INPUT') {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.contentEditable === 'true') {
        element.textContent = '';
        element.innerText = '';
        // Trigger input event for contenteditable
        const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true });
        element.dispatchEvent(inputEvent);
    }
}

// Helper function to type text into input field (works for both input and contenteditable)
function typeIntoField(element, text) {
    if (element.tagName === 'INPUT') {
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.contentEditable === 'true') {
        element.textContent = text;
        element.innerText = text;
        // Trigger input event for contenteditable
        const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true });
        element.dispatchEvent(inputEvent);
    }
}

// Helper function to check if search results are visible
function areSearchResultsVisible() {
    const chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]');
    if (!chatListContainer) return false;
    
    // Check if there are any chat rows visible
    const chatRows = chatListContainer.querySelectorAll('[role="row"]');
    return chatRows.length > 0;
}

// Helper function to find the WhatsApp message input field
function findMessageInputField() {
    // WhatsApp Web uses a contenteditable div for message input
    // Try multiple selectors to find it
    const selectors = [
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"].selectable-text',
        'footer div[contenteditable="true"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            // Check if it's in the message input area (usually in footer)
            const footer = el.closest('footer') || el.closest('[role="textbox"]');
            if (footer || el.getAttribute('data-tab') === '10') {
                return el;
            }
        }
    }
    
    // Fallback: find any contenteditable in the main chat area
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (main) {
        const contenteditables = main.querySelectorAll('div[contenteditable="true"]');
        // Usually the last one is the input
        if (contenteditables.length > 0) {
            return contenteditables[contenteditables.length - 1];
        }
    }
    
    return null;
}

// Helper function to send a message
async function sendMessage(messageText) {
    const inputField = findMessageInputField();
    
    if (!inputField) {
        console.error('[Preload] Could not find message input field');
        return false;
    }
    
    try {
        // Focus the input field
        inputField.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Clear any existing content
        inputField.textContent = '';
        inputField.innerText = '';
        
        // Type the message
        typeIntoField(inputField, messageText);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Trigger input event to ensure WhatsApp recognizes the text
        const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true, data: messageText });
        inputField.dispatchEvent(inputEvent);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Try to find and click the send button
        const sendButton = inputField.closest('footer')?.querySelector('button[aria-label*="Send"], button[aria-label*="שלח"], span[data-icon="send"]')?.closest('button');
        
        if (sendButton) {
            sendButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
        }
        
        // Fallback: Press Enter key
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        inputField.dispatchEvent(enterEvent);
        
        const enterEventUp = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        inputField.dispatchEvent(enterEventUp);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
    } catch (error) {
        console.error('[Preload] Error sending message:', error);
        return false;
    }
}

// True if longStr contains shortStr at a word boundary (start, end, or after space/comma). Avoids "טל" matching "מיטל".
function containsAtWordBoundary(longStr, shortStr) {
    if (!longStr || !shortStr) return false;
    const idx = longStr.indexOf(shortStr);
    if (idx === -1) return false;
    const atStart = idx === 0;
    const atEnd = idx + shortStr.length === longStr.length;
    const afterBoundary = idx > 0 && /[\s,]/.test(longStr[idx - 1]);
    const beforeBoundary = idx + shortStr.length >= longStr.length || /[\s,]/.test(longStr[idx + shortStr.length]);
    return (atStart || afterBoundary) && (atEnd || beforeBoundary);
}

// Helper function to find a specific chat in the main chat list (not search results)
function findChatInMainList(chatName, chatListContainer) {
    if (!chatListContainer) return null;
    
    // Find all chat rows in the main list
    const chatRows = chatListContainer.querySelectorAll('[role="row"]');
    
    const normalizedChatName = normalizeText(chatName);
    const chatNameBase = normalizedChatName.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
    
    // Debug: Log first few chat names found (only once per call to avoid spam)
    const debugChatNames = [];
    const maxDebugLogs = 3;
    
    for (const row of chatRows) {
        // Try multiple selectors to find the chat name element
        let nameElement = row.querySelector('div[role="gridcell"] span[title]');
        if (!nameElement) {
            nameElement = row.querySelector('div[role="gridcell"] div[title]');
        }
        if (!nameElement) {
            nameElement = row.querySelector('span[title]');
        }
        if (!nameElement) {
            nameElement = row.querySelector('div[title]');
        }
        
        if (nameElement) {
            const scrapedTitle = nameElement.getAttribute('title') || nameElement.textContent || '';
            const trimmedTitle = scrapedTitle.trim();
            
            // Debug: Log first few chat names
            if (debugChatNames.length < maxDebugLogs && trimmedTitle && !debugChatNames.includes(trimmedTitle)) {
                debugChatNames.push(trimmedTitle);
            }
            
            const normalizedTitle = normalizeText(trimmedTitle);
            const titleBase = normalizedTitle.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
            
            // Try exact match first
            if (trimmedTitle === chatName || normalizedTitle === normalizedChatName) {
                console.log(`Found chat "${chatName}" in main list (exact match: "${trimmedTitle}")`);
                return row;
            }
            
            // Try base match (without emojis/special chars) - both directions
            if (chatNameBase && titleBase) {
                if (titleBase === chatNameBase) {
                    console.log(`Found chat "${chatName}" in main list (base exact match: "${trimmedTitle}")`);
                    return row;
                }
                if (containsAtWordBoundary(titleBase, chatNameBase)) {
                    console.log(`Found chat "${chatName}" in main list (base contains match: "${trimmedTitle}")`);
                    return row;
                }
                if (containsAtWordBoundary(chatNameBase, titleBase)) {
                    console.log(`Found chat "${chatName}" in main list (base reverse contains match: "${trimmedTitle}")`);
                    return row;
                }
            }
            
            // Try normalized contains match - both directions (word boundary to avoid "טל" matching "מיטל")
            if (containsAtWordBoundary(normalizedTitle, normalizedChatName)) {
                console.log(`Found chat "${chatName}" in main list (normalized contains match: "${trimmedTitle}")`);
                return row;
            }
            if (containsAtWordBoundary(normalizedChatName, normalizedTitle)) {
                console.log(`Found chat "${chatName}" in main list (normalized reverse contains match: "${trimmedTitle}")`);
                return row;
            }
            
            // Exact no-space match only (avoid substring: "טל" in "מיטלתומר")
            if (normalizedChatName.length > 0 && normalizedTitle.length > 0) {
                const chatNameNoSpace = normalizedChatName.replace(/\s/g, '');
                const titleNoSpace = normalizedTitle.replace(/\s/g, '');
                if (chatNameNoSpace === titleNoSpace) {
                    console.log(`Found chat "${chatName}" in main list (no-space exact match: "${trimmedTitle}")`);
                    return row;
                }
            }
        }
    }
    
    // Debug: Log what we found
    if (debugChatNames.length > 0) {
        console.log(`Phase 2: Checked ${chatRows.length} rows, sample names: ${debugChatNames.join(', ')}`);
    }
    
    return null;
}

// Helper function to find a specific chat in search results
function findChatInSearchResults(chatName) {
    const chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]');
    if (!chatListContainer) return null;
    
    // Find all chat rows in the search results
    const chatRows = chatListContainer.querySelectorAll('[role="row"]');
    
    const normalizedChatName = normalizeText(chatName);
    const chatNameBase = normalizedChatName.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
    
    console.log(`Searching through ${chatRows.length} chat rows for: ${chatName} (normalized: "${normalizedChatName}", base: "${chatNameBase}")`);
    
    const foundChatNames = [];
    const maxDebugLogs = 10; // Log first 10 for debugging
    
    for (const row of chatRows) {
        // Try multiple selectors to find the chat name element
        let nameElement = row.querySelector('div[role="gridcell"] span[title]');
        if (!nameElement) {
            nameElement = row.querySelector('div[role="gridcell"] div[title]');
        }
        if (!nameElement) {
            nameElement = row.querySelector('span[title]');
        }
        if (!nameElement) {
            nameElement = row.querySelector('div[title]');
        }
        
        if (nameElement) {
            const scrapedTitle = nameElement.getAttribute('title') || nameElement.textContent || '';
            const trimmedTitle = scrapedTitle.trim();
            
            // Debug: Log first few chat names found
            if (foundChatNames.length < maxDebugLogs && !foundChatNames.includes(trimmedTitle)) {
                foundChatNames.push(trimmedTitle);
                console.log(`  Checking chat ${foundChatNames.length}: "${trimmedTitle}"`);
            }
            
            const normalizedTitle = normalizeText(trimmedTitle);
            const titleBase = normalizedTitle.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
            
            // Try exact match first
            if (trimmedTitle === chatName || normalizedTitle === normalizedChatName) {
                console.log(`Found chat "${chatName}" in search results (exact match: "${trimmedTitle}")`);
                return row;
            }
            
            // Try base match (without emojis/special chars) - both directions
            if (chatNameBase && titleBase) {
                if (titleBase === chatNameBase) {
                    console.log(`Found chat "${chatName}" in search results (base exact match: "${trimmedTitle}")`);
                    return row;
                }
                if (containsAtWordBoundary(titleBase, chatNameBase)) {
                    console.log(`Found chat "${chatName}" in search results (base contains match: "${trimmedTitle}")`);
                    return row;
                }
                if (containsAtWordBoundary(chatNameBase, titleBase)) {
                    console.log(`Found chat "${chatName}" in search results (base reverse contains match: "${trimmedTitle}")`);
                    return row;
                }
            }
            
            if (containsAtWordBoundary(normalizedTitle, normalizedChatName)) {
                console.log(`Found chat "${chatName}" in search results (normalized contains match: "${trimmedTitle}")`);
                return row;
            }
            if (containsAtWordBoundary(normalizedChatName, normalizedTitle)) {
                console.log(`Found chat "${chatName}" in search results (normalized reverse contains match: "${trimmedTitle}")`);
                return row;
            }
            
            // Try character-by-character comparison for Hebrew (handles encoding differences)
            if (normalizedChatName.length > 0 && normalizedTitle.length > 0) {
                // Remove all whitespace and compare
                const chatNameNoSpace = normalizedChatName.replace(/\s/g, '');
                const titleNoSpace = normalizedTitle.replace(/\s/g, '');
                if (chatNameNoSpace === titleNoSpace || chatNameNoSpace.includes(titleNoSpace) || titleNoSpace.includes(chatNameNoSpace)) {
                    console.log(`Found chat "${chatName}" in search results (no-space match: "${trimmedTitle}")`);
                    return row;
                }
            }
        }
    }
    
    // Log all found chat names for debugging
    if (foundChatNames.length > 0) {
        console.log(`Chat "${chatName}" not found. Found ${foundChatNames.length} chat names (showing first ${Math.min(maxDebugLogs, foundChatNames.length)}):`);
        foundChatNames.slice(0, maxDebugLogs).forEach((name, idx) => {
            console.log(`  ${idx + 1}. "${name}"`);
        });
    } else {
        console.log(`Chat "${chatName}" not found. No chat names extracted from ${chatRows.length} rows.`);
    }
    
    return null;
}

// Helper function to normalize text for comparison (handles whitespace, encoding, etc.)
function normalizeText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ').normalize('NFKC');
}

// Helper function to verify the correct chat is open by checking the header
function verifyCorrectChatOpen(chatName) {
    const normalizedChatName = normalizeText(chatName);
    // Remove emojis and special characters for more flexible matching
    const chatNameBase = normalizedChatName.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
    
    // Try multiple selectors for the chat header/title
    const headerSelectors = [
        'header span[title]',
        'header div[title]',
        '[data-testid="conversation-header"] span[title]',
        '[data-testid="conversation-header"] div[title]',
        'div[role="main"] header span[title]',
        'div[role="main"] header div[title]',
        'header span[title]',
        'header div',
        '[data-testid="conversation-header"] span',
        '[data-testid="conversation-header"] div'
    ];
    
    const foundTitles = [];
    
    for (const selector of headerSelectors) {
        const headerElements = document.querySelectorAll(selector);
        for (const el of headerElements) {
            const rawTitle = el.getAttribute('title') || el.textContent || '';
            const normalizedTitle = normalizeText(rawTitle);
            const titleBase = normalizedTitle.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
            
            // Log for debugging (only log unique titles)
            if (rawTitle && !foundTitles.includes(rawTitle)) {
                foundTitles.push(rawTitle);
            }
            
            // Skip empty or very short titles
            if (!rawTitle || rawTitle.trim().length < 2) {
                continue;
            }
            
            // Skip if normalized title is empty
            if (!normalizedTitle || normalizedTitle.length < 2) {
                continue;
            }
            
            // Try exact match first
            if (normalizedTitle === normalizedChatName && normalizedChatName.length > 0) {
                console.log(`Verified correct chat is open: ${chatName} (exact match: "${rawTitle}")`);
                return true;
            }
            
            // Try base match (without emojis/special chars) - require substantial match
            if (chatNameBase && titleBase && chatNameBase.length >= 3 && titleBase.length >= 3) {
                if (titleBase === chatNameBase) {
                    console.log(`Verified correct chat is open: ${chatName} (base exact match: "${rawTitle}")`);
                    return true;
                }
                if (containsAtWordBoundary(titleBase, chatNameBase) && chatNameBase.length >= Math.min(3, chatNameBase.length)) {
                    console.log(`Verified correct chat is open: ${chatName} (base contains match: "${rawTitle}")`);
                    return true;
                }
            }
            
            if (normalizedChatName.length >= 3 && normalizedTitle.length >= 3) {
                if (containsAtWordBoundary(normalizedTitle, normalizedChatName)) {
                    console.log(`Verified correct chat is open: ${chatName} (normalized contains match: "${rawTitle}")`);
                    return true;
                }
                if (containsAtWordBoundary(normalizedChatName, normalizedTitle) && Math.abs(normalizedChatName.length - normalizedTitle.length) <= 2) {
                    console.log(`Verified correct chat is open: ${chatName} (normalized reverse match: "${rawTitle}")`);
                    return true;
                }
            }
        }
    }
    
    if (foundTitles.length > 0) {
        console.warn(`CTO DEBUG: Chat verification - Expected: "${chatName}" (normalized: "${normalizedChatName}", base: "${chatNameBase}")`);
        console.warn(`CTO DEBUG: Found titles: ${foundTitles.slice(0, 5).map(t => `"${t}"`).join(', ')}${foundTitles.length > 5 ? '...' : ''}`);
        for (const title of foundTitles) {
            const normalizedTitle = normalizeText(title);
            const titleBase = normalizedTitle.replace(/[^\w\s\u0590-\u05FF]/g, '').trim();
            if (chatNameBase && titleBase && (containsAtWordBoundary(titleBase, chatNameBase) || containsAtWordBoundary(chatNameBase, titleBase))) {
                console.log(`CTO DEBUG: Found potential match: "${title}" (base: "${titleBase}") contains chat name base: "${chatNameBase}"`);
                return true;
            }
        }
    } else {
        console.error(`CTO DEBUG: No header titles found. Selectors may need updating.`);
    }
    
    return false;
}

// Helper function to verify chat panel is loaded
function verifyChatPanelLoaded() {
    const selectors = [
        '[data-scrolltracepolicy="wa.web.conversation.messages"]',
        '[aria-label*="רשימת הודעות"]',
        '[aria-label*="Message list"]',
        '[role="log"]',
        'div[data-testid="conversation-panel-messages"]'
    ];
    
    for (const selector of selectors) {
        const panel = document.querySelector(selector);
        if (panel) {
            console.log(`Chat panel verified using selector: ${selector}`);
            return true;
        }
    }
    
    return false;
}

// Function 2: Open a chat by scrolling through the chat list (ROBUST, DOM-BASED METHOD)
async function clickChat(chatName) {
    console.log(`Attempting to open chat: ${chatName}`);
    
    try {
        // First, ensure any open chat panel is closed/back button is clicked to show chat list
        // This is important if a chat was previously opened
        const backButton = document.querySelector('button[aria-label="Back"], button[aria-label="חזרה"], span[data-icon="back"]');
        if (backButton) {
            console.log('Found back button, clicking to return to chat list...');
            backButton.click();
            await new Promise(r => setTimeout(r, 500)); // Wait for chat list to appear
        }
        
        // Get main chat list container
        let chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]');
        if (!chatListContainer) {
            console.log('Chat list container not found immediately, waiting and retrying...');
            await new Promise(r => setTimeout(r, 1000));
            chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]');
        }
        
        if (!chatListContainer) {
            console.error('Error: Main chat list container not found after retry');
            return { success: false, error: 'Chat list container not found' };
        }
        
        // Ensure container is visible (not hidden by chat panel)
        const containerRect = chatListContainer.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
            console.log('Chat list container is not visible, trying to make it visible...');
            // Try clicking back button again or finding the chat list
            const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label="חזרה"]');
            if (backBtn) {
                backBtn.click();
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        
        // Reset scroll position to top - do this multiple times to ensure it sticks
        console.log('Resetting chat list scroll position to top...');
        for (let resetAttempt = 0; resetAttempt < 5; resetAttempt++) {
            chatListContainer.scrollTop = 0;
            await new Promise(r => setTimeout(r, 200));
            
            // Also try scrolling the first row into view to force reset
            const firstRow = chatListContainer.querySelector('[role="row"]');
            if (firstRow) {
                firstRow.scrollIntoView({ behavior: 'auto', block: 'start' });
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        // Verify scroll position is actually at top
        const actualScrollTop = chatListContainer.scrollTop;
        if (actualScrollTop > 10) {
            console.log(`Warning: Scroll position is ${actualScrollTop}px after resets. Forcing to 0 with scrollIntoView...`);
            // Try using scrollIntoView on first element to force scroll to top
            const firstRow = chatListContainer.querySelector('[role="row"]');
            if (firstRow) {
                firstRow.scrollIntoView({ behavior: 'auto', block: 'start' });
                await new Promise(r => setTimeout(r, 500));
            }
            chatListContainer.scrollTop = 0;
            await new Promise(r => setTimeout(r, 500));
        }
        
        console.log(`Final scroll position after reset: ${chatListContainer.scrollTop}px`);
        
        // Verify container is scrollable
        const scrollHeight = chatListContainer.scrollHeight;
        const clientHeight = chatListContainer.clientHeight;
        console.log(`Chat list container - scrollHeight: ${scrollHeight}px, clientHeight: ${clientHeight}px, scrollTop: ${chatListContainer.scrollTop}px, scrollable: ${scrollHeight > clientHeight}`);
        
        if (scrollHeight <= clientHeight) {
            console.warn('Chat list appears to not be scrollable (all chats may be visible)');
        }
        
        let chatRow = null;
        let scrollPosition = 0;
        const scrollStep = 200; // Scroll 200px at a time (smaller steps for better coverage)
        const maxScrolls = 50; // Enough to scroll through large lists (10,000px max)
        let previousRowCount = 0;
        let noChangeCount = 0;
        const maxNoChangeCount = 5; // Require 5 consecutive scrolls with no change before stopping
        
        const initialRowCount = chatListContainer.querySelectorAll('[role="row"]').length;
        console.log(`Starting systematic scroll through main chat list. Initial rows: ${initialRowCount}, max scroll: ${maxScrolls * scrollStep}px`);
        
        // Always use scrollIntoView method to ensure all chats are loaded (works even when scrollHeight > clientHeight)
        // This is more reliable after scrolling operations
        console.log(`Using scrollIntoView method to find chat (ensures all chats are loaded)...`);
        
        // Get all currently visible rows
        let allVisibleRows = Array.from(chatListContainer.querySelectorAll('[role="row"]'));
        console.log(`Found ${allVisibleRows.length} visible rows. Using scrollIntoView to load all chats and find target...`);
        
        // First, check if chat is already in visible rows
        chatRow = findChatInMainList(chatName, chatListContainer);
        if (chatRow) {
            console.log(`Found chat in visible rows before scrolling`);
        } else {
            // Scroll through ALL rows to trigger lazy loading and ensure all chats are in DOM
            const maxRowsToCheck = Math.max(allVisibleRows.length, 200); // Check at least 200 rows
            console.log(`Scrolling through up to ${maxRowsToCheck} rows to load all chats...`);
            
            for (let i = 0; i < allVisibleRows.length && !chatRow; i++) {
                const row = allVisibleRows[i];
                
                // Scroll row into view to trigger lazy loading
                row.scrollIntoView({ behavior: 'auto', block: 'center' });
                await new Promise(r => setTimeout(r, 100)); // Shorter delay since we're checking many rows
                
                // Check if chat appears after this scroll
                chatRow = findChatInMainList(chatName, chatListContainer);
                if (chatRow) {
                    console.log(`Found chat using scrollIntoView at row ${i + 1}/${allVisibleRows.length}`);
                    break;
                }
                
                // Check if more rows were loaded
                const currentRows = chatListContainer.querySelectorAll('[role="row"]');
                if (currentRows.length > allVisibleRows.length) {
                    // New rows loaded, update our list and check them
                    allVisibleRows = Array.from(currentRows);
                    console.log(`New rows loaded: ${allVisibleRows.length} total rows now`);
                    
                    // Check all new rows
                    for (let j = allVisibleRows.length - (currentRows.length - allVisibleRows.length); j < allVisibleRows.length; j++) {
                        const newRow = allVisibleRows[j];
                        const name = extractChatNameFromRow(newRow);
                        if (name) {
                            const normalizedName = normalizeText(name);
                            const normalizedChatName = normalizeText(chatName);
                            if (normalizedName === normalizedChatName || 
                                containsAtWordBoundary(normalizedName, normalizedChatName) || 
                                containsAtWordBoundary(normalizedChatName, normalizedName)) {
                                chatRow = newRow;
                                console.log(`Found chat in newly loaded rows: "${name}"`);
                                break;
                            }
                        }
                    }
                    if (chatRow) break;
                }
                
                // Log progress every 50 rows
                if ((i + 1) % 50 === 0) {
                    console.log(`scrollIntoView progress: ${i + 1}/${allVisibleRows.length} rows checked, ${chatListContainer.querySelectorAll('[role="row"]').length} total in DOM`);
                }
            }
        }
        
        // If still not found and scrollHeight > clientHeight, try normal scrolling as fallback
        if (!chatRow && scrollHeight > clientHeight) {
            console.log(`Chat not found with scrollIntoView. Trying normal scrolling as fallback...`);
            
            // Reset scroll position for normal scrolling
            chatListContainer.scrollTop = 0;
            await new Promise(r => setTimeout(r, 300));
            scrollPosition = 0;
            
            while (scrollPosition < maxScrolls * scrollStep && !chatRow) {
            // Set scroll position
            const requestedScroll = scrollPosition;
            chatListContainer.scrollTop = requestedScroll;
            
            // Wait longer for WhatsApp to render new chats (virtualization takes time)
            await new Promise(r => setTimeout(r, 600));
            
            // Verify scroll actually happened
            const actualScrollTop = chatListContainer.scrollTop;
            
            // Check if chat appears in currently visible rows
            chatRow = findChatInMainList(chatName, chatListContainer);
            if (chatRow) {
                console.log(`Found chat at scroll position ${scrollPosition}px (actual: ${actualScrollTop.toFixed(0)}px)`);
                break;
            }
            
            // Check if we've reached the end (no new rows appearing)
            const currentRowCount = chatListContainer.querySelectorAll('[role="row"]').length;
            
            // Log every scroll for debugging
            console.log(`Scroll ${Math.floor(scrollPosition / scrollStep) + 1}/${maxScrolls} - Requested: ${scrollPosition}px, Actual: ${actualScrollTop.toFixed(0)}px, Rows: ${currentRowCount} (was ${previousRowCount})`);
            
            // Check if scroll actually happened (sometimes scrollTop gets clamped at the end)
            if (Math.abs(actualScrollTop - requestedScroll) > 100 && scrollPosition > scrollStep * 2) {
                // Scroll was significantly clamped, we might be at the end
                console.log(`Scroll position significantly clamped (requested ${scrollPosition}px, got ${actualScrollTop.toFixed(0)}px). Likely at end.`);
                noChangeCount += 2; // Count this as evidence of being at the end
            }
            
            // Check if we're making progress
            if (currentRowCount === previousRowCount && scrollPosition > scrollStep * 2) {
                noChangeCount++;
                if (noChangeCount >= maxNoChangeCount) {
                    // No new content for several consecutive scrolls, we've likely reached the end
                    console.log(`Reached end of chat list (no new rows for ${maxNoChangeCount} consecutive scrolls at ${scrollPosition}px)`);
                    break;
                }
            } else if (currentRowCount > previousRowCount) {
                // We got new rows, reset the counter
                noChangeCount = 0;
            }
            previousRowCount = currentRowCount;
            
            // Only advance if scroll actually moved
            if (Math.abs(actualScrollTop - requestedScroll) < 50) {
                // Scroll worked, advance position
                scrollPosition += scrollStep;
            } else {
                // Scroll was clamped, try smaller increment or we're at end
                if (actualScrollTop >= scrollHeight - clientHeight - 10) {
                    // We're at the bottom
                    console.log(`Reached bottom of chat list (scrollHeight: ${scrollHeight}px)`);
                    break;
                }
                // Try smaller increment
                scrollPosition = actualScrollTop + scrollStep;
            }
            }
        }
        
        // If still not found and scrollHeight > clientHeight, try scrolling from bottom up
        if (!chatRow && scrollHeight > clientHeight) {
            console.log(`Not found scrolling down. Trying scroll from bottom up...`);
            
            // Scroll to bottom first
            chatListContainer.scrollTop = scrollHeight;
            await new Promise(r => setTimeout(r, 600));
            
            // Check at bottom
            chatRow = findChatInMainList(chatName, chatListContainer);
            
            if (!chatRow) {
                // Scroll up from bottom
                let reverseScrollPosition = scrollHeight;
                const reverseMaxScrolls = 20;
                let reverseScrollCount = 0;
                
                while (reverseScrollPosition > 0 && !chatRow && reverseScrollCount < reverseMaxScrolls) {
                    reverseScrollPosition = Math.max(0, reverseScrollPosition - scrollStep);
                    chatListContainer.scrollTop = reverseScrollPosition;
                    await new Promise(r => setTimeout(r, 600));
                    
                    chatRow = findChatInMainList(chatName, chatListContainer);
                    if (chatRow) {
                        console.log(`Found chat scrolling up from bottom at position ${reverseScrollPosition}px`);
                        break;
                    }
                    
                    reverseScrollCount++;
                    if (reverseScrollCount % 5 === 0) {
                        console.log(`Reverse scroll ${reverseScrollCount}, position: ${reverseScrollPosition}px`);
                    }
                }
            } else {
                console.log(`Found chat at bottom of list`);
            }
        }
        
        if (!chatRow) {
            console.error(`Chat "${chatName}" not found in main chat list after all methods`);
            return { success: false, error: `Chat "${chatName}" not found in main chat list` };
        }
        
        console.log('Found chat in main list');
        
        // Click on the found chat row
        if (chatRow) {
            console.log('Clicking on found chat row');
            
            // Click on the specific chat row using native click
            // Find the clickable element within the row
            const clickableElement = chatRow.querySelector(':scope > div:first-child') || chatRow;
            
            // Ensure the element is visible and in viewport - use immediate scroll
            if (clickableElement.scrollIntoView) {
                clickableElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                await new Promise(r => setTimeout(r, 500)); // Wait longer for scroll to complete
            }
            
            // Also ensure the chat list container has scrolled to show this element
            const chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]');
            if (chatListContainer) {
                const rowRect = chatRow.getBoundingClientRect();
                const containerRect = chatListContainer.getBoundingClientRect();
                
                // If row is above container, scroll container up
                if (rowRect.top < containerRect.top) {
                    chatListContainer.scrollTop -= (containerRect.top - rowRect.top + 50);
                    await new Promise(r => setTimeout(r, 300));
                }
                // If row is below container, scroll container down
                else if (rowRect.bottom > containerRect.bottom) {
                    chatListContainer.scrollTop += (rowRect.bottom - containerRect.bottom + 50);
                    await new Promise(r => setTimeout(r, 300));
                }
            }
            
            // Get the bounding rectangle for the element AFTER scrolling
            let rect = clickableElement.getBoundingClientRect();
            
            // Verify element has dimensions (exists in DOM)
            if (rect.width === 0 || rect.height === 0) {
                console.error('Error: Chat row element is not visible (width or height is 0)');
                return { success: false, error: 'Chat row element not visible' };
            }
            
            // Check viewport dimensions - if window is hidden, viewport might be 0
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
            const isWindowHidden = viewportHeight === 0 || viewportWidth === 0 || (viewportHeight < 100 && viewportWidth < 100);
            
            // If window is hidden, skip strict viewport checks and use element position directly
            if (!isWindowHidden) {
                // Window is visible - check if element is in viewport
                if (rect.top < 0 || rect.bottom > viewportHeight || rect.left < 0 || rect.right > viewportWidth) {
                    console.log('Element is off-screen. Re-scrolling and re-checking...');
                    clickableElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                    await new Promise(r => setTimeout(r, 500));
                    rect = clickableElement.getBoundingClientRect();
                }
                
                // Final check for visible window - element should be in viewport
                if (rect.top < 0 || rect.bottom > viewportHeight || rect.left < 0 || rect.right > viewportWidth) {
                    console.warn(`Warning: Chat row element is outside viewport, but continuing anyway (window may be hidden). Top: ${rect.top}, Bottom: ${rect.bottom}, Left: ${rect.left}, Right: ${rect.right}`);
                    // Don't return error - allow click to proceed even if slightly outside viewport
                }
            } else {
                // Window is hidden - use element position directly without viewport checks
                console.log('Window appears to be hidden - using element coordinates directly');
            }
            
            // Calculate click coordinates (use element center)
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            
            console.log(`Clicking on chat row at coordinates: X=${x.toFixed(0)}, Y=${y.toFixed(0)} (viewport: ${viewportWidth}x${viewportHeight}, hidden: ${isWindowHidden})`);
            
            // For hidden windows, coordinates can be outside viewport - that's OK
            // For visible windows, warn but still allow click if coordinates are reasonable
            if (!isWindowHidden && (x < -100 || x > viewportWidth + 100 || y < -100 || y > viewportHeight + 100)) {
                console.warn(`Warning: Click coordinates are far outside viewport, but proceeding anyway. X: ${x}, Y: ${y}`);
                // Don't return error - allow click to proceed
            }
            
            // Try multiple click methods for maximum compatibility
            
            // Method 1: Native click via IPC (most reliable)
            ipcRenderer.send('whatsapp:request-native-click', { x, y, name: chatName });
            
            // Method 2: Try direct click on the element first (sometimes more reliable)
            try {
                clickableElement.click();
                console.log('Direct click() method executed');
            } catch (e) {
                console.warn('Direct click() failed:', e);
            }
            
            // Method 3: Also try synthetic events with full properties
            const syntheticClick = () => {
                // Try pointer events first (more modern)
                const pointerDown = new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    pointerId: 1,
                    pointerType: 'mouse',
                    clientX: x,
                    clientY: y
                });
                clickableElement.dispatchEvent(pointerDown);
                
                const pointerUp = new PointerEvent('pointerup', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    pointerId: 1,
                    pointerType: 'mouse',
                    clientX: x,
                    clientY: y
                });
                clickableElement.dispatchEvent(pointerUp);
                
                // Also try mouse events
                const mouseDown = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    clientX: x,
                    clientY: y,
                    buttons: 1
                });
                clickableElement.dispatchEvent(mouseDown);
                
                const mouseUp = new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    clientX: x,
                    clientY: y,
                    buttons: 0
                });
                clickableElement.dispatchEvent(mouseUp);
                
                const click = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    clientX: x,
                    clientY: y
                });
                clickableElement.dispatchEvent(click);
            };
            
            // Execute synthetic click after a small delay
            setTimeout(syntheticClick, 100);
            
            // Wait a bit for the click to register
            await new Promise(r => setTimeout(r, 500));
            
            console.log('All click methods executed (native IPC, direct click, synthetic events)');
        }
        
        // Wait for conversation panel to load (with retries)
        // Give it some initial time to start loading
        await new Promise(r => setTimeout(r, 500));
        
        const maxWaitTime = 15000; // 15 seconds max
        const checkInterval = 200; // Check every 200ms
        const maxChecks = maxWaitTime / checkInterval;
        let checks = 0;
        let chatPanelLoaded = false;
        
        console.log('Waiting for chat panel to load...');
        
        while (checks < maxChecks && !chatPanelLoaded) {
            await new Promise(r => setTimeout(r, checkInterval));
            chatPanelLoaded = verifyChatPanelLoaded();
            checks++;
            
            if (chatPanelLoaded) {
                console.log(`Chat panel loaded after ${500 + (checks * checkInterval)}ms`);
                break;
            }
            
            // Log progress every 2 seconds
            if (checks % 10 === 0) {
                console.log(`Still waiting for chat panel... (${checks * checkInterval}ms elapsed)`);
            }
        }
        
        if (!chatPanelLoaded) {
            console.error(`Error: Chat panel did not load after ${500 + (checks * checkInterval)}ms. Chat may not exist or click failed.`);
            return { success: false, error: 'Chat panel did not load' };
        }
        
        // Verify the correct chat is open by checking the header
        await new Promise(r => setTimeout(r, 500)); // Wait for header to update
        
        const correctChatOpen = verifyCorrectChatOpen(chatName);
        if (!correctChatOpen) {
            // Verification failed - the wrong chat is likely open
            console.error(`Error: Could not verify chat header matches "${chatName}". Wrong chat may be open.`);
            return { success: false, error: `Verification failed: Chat header does not match "${chatName}"` };
        }
        
        // Additional wait to ensure panel is fully ready
        await new Promise(r => setTimeout(r, 500));
        
        console.log(`Successfully opened correct chat: ${chatName}`);
        return { success: true };
        
    } catch (error) {
        console.error(`Error during chat selection: ${error.message}`);
        return { success: false, error: error.message };
    }
}


// --- Utility for date extraction (to handle "TIME, DD.MM.YYYY" format) ---
function extractDDMMFromTimestamp(rawTimestamp) {
    const timestampParts = rawTimestamp.split(', ');
    const timestampDatePart = timestampParts.length > 1 ? timestampParts[1].trim() : rawTimestamp; 
    
    const dateMatch = timestampDatePart.match(/(\d{1,2})[\.\/](\d{1,2})/);

    if (dateMatch) {
        const messageDD = dateMatch[1].padStart(2, '0');
        const messageMM = dateMatch[2].padStart(2, '0');
        return `${messageDD}.${messageMM}`; 
    }
    return null;
}


// Helper function to check if a date (DD.MM) is strictly before today
function isDateBeforeToday(dateDDMM, todayDDMM) {
    if (!dateDDMM) return false;
    
    // Handle both DD.MM and MM.DD formats by trying both interpretations
    const [datePart1, datePart2] = dateDDMM.split('.').map(Number);
    const [todayDD, todayMM] = todayDDMM.split('.').map(Number);
    
    // Try DD.MM format first (datePart1 = day, datePart2 = month)
    let dateDD = datePart1;
    let dateMM = datePart2;
    
    // If the month part is > 12, it's likely MM.DD format, so swap
    if (dateMM > 12) {
        dateDD = datePart2;
        dateMM = datePart1;
    }
    
    // Compare month first, then day
    if (dateMM < todayMM) return true;
    if (dateMM > todayMM) return false;
    return dateDD < todayDD;
}

// Helper function to check if a date is NOT today (handles both DD.MM and MM.DD formats)
function isDateNotToday(dateDDMM, todayDDMM) {
    if (!dateDDMM) return false;
    
    // If dates are exactly equal, it's today
    if (dateDDMM === todayDDMM) return false;
    
    // Parse both dates
    const [datePart1, datePart2] = dateDDMM.split('.').map(Number);
    const [todayDD, todayMM] = todayDDMM.split('.').map(Number);
    
    // Try DD.MM interpretation (datePart1 = day, datePart2 = month)
    if (datePart2 <= 12) { // Valid month
        if (datePart2 === todayMM && datePart1 === todayDD) {
            return false; // It's today in DD.MM format
        }
        // Check if it's before today in DD.MM format
        if (datePart2 < todayMM || (datePart2 === todayMM && datePart1 < todayDD)) {
            return true; // It's before today
        }
    }
    
    // Try MM.DD interpretation (datePart1 = month, datePart2 = day)
    if (datePart1 <= 12) { // Valid month
        if (datePart1 === todayMM && datePart2 === todayDD) {
            return false; // It's today in MM.DD format
        }
        // Check if it's before today in MM.DD format
        if (datePart1 < todayMM || (datePart1 === todayMM && datePart2 < todayDD)) {
            return true; // It's before today
        }
    }
    
    // If we can't determine, assume it's not today to be safe
    // (This handles edge cases where format is ambiguous)
    return true;
}

// Helper function to get the oldest message date from the DOM
function getOldestMessageDate() {
    const messageElements = document.querySelectorAll('div[data-pre-plain-text]');
    if (messageElements.length === 0) return null;
    
    const oldestMessageElement = messageElements[0];
    const attr = oldestMessageElement.getAttribute('data-pre-plain-text');
    if (!attr) return null;
    
    const rawTimestampMatch = attr.match(/\[(.*?)\]/);
    if (!rawTimestampMatch) return null;
    
    const rawTimestamp = rawTimestampMatch[1].trim();
    return extractDDMMFromTimestamp(rawTimestamp);
}

// Helper function to check if a date matches today (handles both DD.MM and MM.DD formats)
function isDateToday(dateDDMM, todayDDMM) {
    if (!dateDDMM) return false;
    
    // If dates are exactly equal, it's today
    if (dateDDMM === todayDDMM) return true;
    
    // Parse both dates
    const [datePart1, datePart2] = dateDDMM.split('.').map(Number);
    const [todayDD, todayMM] = todayDDMM.split('.').map(Number);
    
    // Try DD.MM interpretation (datePart1 = day, datePart2 = month)
    if (datePart2 <= 12) { // Valid month
        if (datePart2 === todayMM && datePart1 === todayDD) {
            return true; // It's today in DD.MM format
        }
    }
    
    // Try MM.DD interpretation (datePart1 = month, datePart2 = day)
    if (datePart1 <= 12) { // Valid month
        if (datePart1 === todayMM && datePart2 === todayDD) {
            return true; // It's today in MM.DD format
        }
    }
    
    return false;
}

// Helper function to count messages from today
function countMessagesFromToday(todayDDMM) {
    const messageElements = document.querySelectorAll('div[data-pre-plain-text]');
    let count = 0;
    let debugCount = 0;
    const maxDebugLogs = 5; // Only log first few for debugging
    
    messageElements.forEach(el => {
        const attr = el.getAttribute('data-pre-plain-text');
        if (!attr) return;
        
        const rawTimestampMatch = attr.match(/\[(.*?)\]/);
        if (!rawTimestampMatch) return;
        
        const rawTimestamp = rawTimestampMatch[1].trim();
        const messageDDMM = extractDDMMFromTimestamp(rawTimestamp);
        
        // Debug logging for first few messages
        if (debugCount < maxDebugLogs && messageDDMM) {
            const isToday = isDateToday(messageDDMM, todayDDMM);
            console.log(`CTO DEBUG: Message date check - Raw: "${rawTimestamp}", Extracted: "${messageDDMM}", Today: "${todayDDMM}", IsToday: ${isToday}`);
            debugCount++;
        }
        
        // Use isDateToday to handle both DD.MM and MM.DD formats
        if (messageDDMM && isDateToday(messageDDMM, todayDDMM)) {
            count++;
        }
    });
    
    return count;
}

// Helper function to extract message data from a DOM element
function extractMessageData(el, todayDDMM) {
    let rawTimestamp = 'Unknown Time';
    let sender = 'You'; 
    
    const attr = el.getAttribute('data-pre-plain-text');
    
    if (attr) {
         const match = attr.match(/\[(.*?)\] (.*?):/);
         if (match) {
             rawTimestamp = match[1].trim(); 
             sender = match[2].trim();      
         } else {
             const timeMatch = attr.match(/\[(.*?)\]/);
             rawTimestamp = timeMatch ? timeMatch[1].trim() : 'Unknown Time';
         }
    }
    
    // Extract date from timestamp to check if it's from today
    const messageDDMM = extractDDMMFromTimestamp(rawTimestamp);
    const isFromToday = messageDDMM && isDateToday(messageDDMM, todayDDMM);
    
    // Extract message text
    let fullText = el.textContent || '';
    const prefix = el.getAttribute('data-pre-plain-text') || '';
    let messageText = fullText.replace(prefix, '').replace(/\u200e/g, '').trim();
    
    // Remove trailing time that might be included in the text content
    // Extract time portion from timestamp (e.g., "19:33" from "19:33, 1/23/2026")
    const timeMatch = rawTimestamp.match(/^(\d{1,2}:\d{2})/);
    if (timeMatch) {
        const timePattern = timeMatch[1]; // e.g., "19:33"
        // Remove trailing time pattern (with optional whitespace before it)
        messageText = messageText.replace(new RegExp(timePattern.replace(':', '\\:') + '\\s*$'), '').trim();
    }
    
    if (!messageText) return null;
    
    return {
        sender: sender,
        time: rawTimestamp,
        text: messageText,
        isFromToday: isFromToday,
        dataAttr: attr // Store the full attribute for deduplication
    };
}

// Global storage for collected messages (persists across DOM changes)
let collectedMessages = new Map();

// Helper function to get the earliest timestamp from today in collectedMessages
function getEarliestTodayTimestamp(collectedMessages, todayDDMM) {
    const todayMessages = Array.from(collectedMessages.values())
        .filter(m => m.isFromToday);
    
    if (todayMessages.length === 0) return null;
    
    // Sort by timestamp (earliest first)
    // We need to parse timestamps to compare them properly
    // Timestamp format is usually "HH:MM, DD.MM.YYYY" or "HH:MM"
    const sortedMessages = todayMessages.sort((a, b) => {
        // Try to extract time and date for comparison
        const timeA = a.time;
        const timeB = b.time;
        
        // If timestamps contain dates, parse them
        // Otherwise, just compare as strings
        return timeA.localeCompare(timeB);
    });
    
    return sortedMessages[0].time;
}

// Function to scroll up and load history until all messages from today are loaded
async function loadFullHistory() {
    // Clear previous collection
    collectedMessages.clear();
    // Wait for chat panel to be fully ready (already verified in clickChat, but add safety delay)
    console.log("CTO DEBUG: Waiting for chat panel to be fully ready...");
    await new Promise(r => setTimeout(r, 1000)); 

    let chatPanel = null;
    let selectorUsed = 'None';

    // 1. Data attribute 
    const selector1 = '[data-scrolltracepolicy="wa.web.conversation.messages"]';
    console.log(`CTO DEBUG: Checking selector 1: ${selector1}`);
    chatPanel = document.querySelector(selector1);
    if (chatPanel) {
        selectorUsed = selector1;
    }

    // 2. Hebrew/RTL aria-label
    if (!chatPanel) {
        const selector2 = '[aria-label*="רשימת הודעות"]';
        console.log(`CTO DEBUG: Checking selector 2: ${selector2}`);
        chatPanel = document.querySelector(selector2);
        if (chatPanel) {
            selectorUsed = selector2;
        }
    }
    
    // 3. English aria-label
    if (!chatPanel) {
        const selector3 = '[aria-label*="Message list"]';
        console.log(`CTO DEBUG: Checking selector 3: ${selector3}`);
        chatPanel = document.querySelector(selector3);
        if (chatPanel) {
            selectorUsed = selector3;
        }
    }

    // 4. Structural fallback role="log"
    if (!chatPanel) {
        const selector4 = '[role="log"]';
        console.log(`CTO DEBUG: Checking selector 4 (Fallback Role): ${selector4}`);
        chatPanel = document.querySelector(selector4);
        if (chatPanel) {
            selectorUsed = selector4;
        }
    }
    
    // 5. data-testid 
    if (!chatPanel) {
        const selector5 = 'div[data-testid="conversation-panel-messages"]';
        console.log(`CTO DEBUG: Checking selector 5 (data-testid): ${selector5}`);
        chatPanel = document.querySelector(selector5);
        if (chatPanel) {
            selectorUsed = selector5;
        }
    }
    
    // 6. Generic Structural Parent
    if (!chatPanel) {
        const selector6 = 'div[role="main"] > div > div > div:nth-child(2)';
        console.log(`CTO DEBUG: Checking selector 6 (structural parent): ${selector6}`);
        chatPanel = document.querySelector(selector6);
        if (chatPanel) {
            selectorUsed = selector6;
        }
    }
    
    // 7. Last Ditch Effort (Very generic scrollable element inside the main pane)
    if (!chatPanel) {
        const selector7 = 'div[role="main"] div[tabindex="-1"]';
        console.log(`CTO DEBUG: Checking selector 7 (tabindex fallback): ${selector7}`);
        chatPanel = document.querySelector(selector7);
        if (chatPanel) {
            selectorUsed = selector7;
        }
    }


    if (chatPanel) {
        console.log(`CTO DEBUG: Chat panel successfully found using selector: ${selectorUsed}`);
        // Log element dimensions to confirm scrollable
        console.log(`CTO DEBUG: Scrollable element found. scrollHeight: ${chatPanel.scrollHeight}, offsetHeight: ${chatPanel.offsetHeight}`);
    } else {
        console.error("Chat panel element not found for scrolling. Please check WhatsApp language/structure.");
        console.log("CTO DEBUG: Failed to find chat panel using any known selector.");
        return; 
    }
    
    const today = new Date();
    const todayDD = String(today.getDate()).padStart(2, '0');
    const todayMM = String(today.getMonth() + 1).padStart(2, '0');
    const todayDDMM = `${todayDD}.${todayMM}`; 
    
    let scrollCount = 0;
    const MAX_SCROLLS = 10; // Increased to allow for more thorough loading
    const SAFETY_SCROLLS = 2; // Number of additional scrolls after date boundary detection
    let dateBoundaryDetected = false;
    let safetyScrollsRemaining = 0;
    let previousTodayCount = 0;
    
    // Collect initial messages before scrolling
    const initialMessageElements = document.querySelectorAll('div[data-pre-plain-text]');
    initialMessageElements.forEach(el => {
        const messageData = extractMessageData(el, todayDDMM);
        if (messageData) {
            collectedMessages.set(messageData.dataAttr, messageData);
        }
    });
    
    const initialCount = collectedMessages.size;
    const initialTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
    console.log(`--- STAGE 0 (Scrolling): Starting history load. Target date: ${todayDDMM}. Initial count: ${initialCount} total, ${initialTodayCount} from today`);

    // Track earliest timestamp from today to detect when we've loaded all messages
    let previousEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
    let earliestTimestampUnchangedCount = 0;
    const REQUIRED_UNCHANGED_SCROLLS = 2; // Stop after 2 consecutive scrolls with same earliest timestamp

    // Phase 1: Normal scrolling - continue until earliest timestamp from today stops moving earlier
    while (scrollCount < MAX_SCROLLS && !dateBoundaryDetected) {
        // Perform the scroll first
        console.log(`CTO DEBUG: Scroll attempt ${scrollCount + 1}. Setting scrollTop=0 on element: ${selectorUsed}`);
        chatPanel.scrollTop = 0; 
        scrollCount++;
        console.log(`Scrolling attempt ${scrollCount}. Waiting 2s for new messages to load...`);

        await new Promise(r => setTimeout(r, 2000)); 

        // Collect messages immediately after scroll (before WhatsApp removes them from DOM)
        const messageElements = document.querySelectorAll('div[data-pre-plain-text]');
        messageElements.forEach(el => {
            const messageData = extractMessageData(el, todayDDMM);
            if (messageData) {
                // Use data attribute as unique key to avoid duplicates
                collectedMessages.set(messageData.dataAttr, messageData);
            }
        });

        const currentMessageCount = collectedMessages.size;
        const currentTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
        const currentEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
        
        console.log(`Messages after scroll: ${currentMessageCount} total in collection, ${currentTodayCount} from today.`);
        console.log(`CTO DEBUG: Earliest timestamp from today: ${currentEarliestTodayTimestamp || 'None'}`);
        
        // Check if earliest timestamp from today has changed
        if (currentEarliestTodayTimestamp) {
            if (currentEarliestTodayTimestamp === previousEarliestTodayTimestamp) {
                earliestTimestampUnchangedCount++;
                console.log(`CTO DEBUG: Earliest timestamp unchanged (${earliestTimestampUnchangedCount}/${REQUIRED_UNCHANGED_SCROLLS})`);
                
                // Stop if earliest timestamp hasn't changed for required number of scrolls
                if (earliestTimestampUnchangedCount >= REQUIRED_UNCHANGED_SCROLLS) {
                    console.log(`--- STAGE 0 COMPLETE ---: Earliest timestamp from today unchanged for ${REQUIRED_UNCHANGED_SCROLLS} consecutive scrolls. All messages from today loaded.`);
                    break;
                }
            } else {
                // Timestamp changed, reset counter
                earliestTimestampUnchangedCount = 0;
                previousEarliestTodayTimestamp = currentEarliestTodayTimestamp;
                console.log(`CTO DEBUG: Earliest timestamp changed to: ${currentEarliestTodayTimestamp}`);
            }
        } else {
            // No messages from today found
            if (currentTodayCount === 0) {
                console.log(`--- STAGE 0 COMPLETE ---: No messages from today found. Stopping.`);
                break;
            }
        }
        
        // Check if the oldest message in DOM is from before today (for catch-up scrolls)
        const oldestDDMM = getOldestMessageDate();
        
        // Debug: Check what the comparison returns
        if (oldestDDMM) {
            const isBefore = isDateBeforeToday(oldestDDMM, todayDDMM);
            const isNotToday = isDateNotToday(oldestDDMM, todayDDMM);
            console.log(`CTO DEBUG: Date comparison - Oldest in DOM: ${oldestDDMM}, Today: ${todayDDMM}, IsBefore: ${isBefore}, IsNotToday: ${isNotToday}`);
        }
        
        // If we've reached messages from before today, start catch-up scrolls
        if (oldestDDMM && isDateNotToday(oldestDDMM, todayDDMM)) {
            // We've reached messages from before today
            // But we should continue scrolling a bit more to catch any remaining messages from today
            // that might be mixed in with older messages
            console.log(`--- STAGE 0 DATE BOUNDARY REACHED ---: Oldest message is from ${oldestDDMM} (before today ${todayDDMM}). Continuing to catch any remaining messages from today.`);
            
            // Continue scrolling to catch any remaining messages from today
            // Stop immediately if count doesn't change
            let previousTodayCount = currentTodayCount;
            let previousEarliestInCatchUp = currentEarliestTodayTimestamp;
            let catchUpScrollCount = 0;
            const MAX_CATCHUP_SCROLLS = 5; // Safety limit
            
            if (currentTodayCount > 0) {
                console.log(`--- STAGE 0 CATCH-UP SCROLLS ---: Starting catch-up scrolls to catch any remaining messages from today.`);
                
                while (catchUpScrollCount < MAX_CATCHUP_SCROLLS && scrollCount < MAX_SCROLLS) {
                    chatPanel.scrollTop = 0;
                    scrollCount++;
                    catchUpScrollCount++;
                    await new Promise(r => setTimeout(r, 2000));
                    
                    // Collect messages immediately after scroll
                    const messageElements = document.querySelectorAll('div[data-pre-plain-text]');
                    messageElements.forEach(el => {
                        const messageData = extractMessageData(el, todayDDMM);
                        if (messageData) {
                            collectedMessages.set(messageData.dataAttr, messageData);
                        }
                    });
                    
                    const newTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
                    const newEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
                    
                    console.log(`Catch-up scroll ${catchUpScrollCount}: Messages from today: ${newTodayCount} (was ${previousTodayCount}), Earliest: ${newEarliestTodayTimestamp || 'None'}`);
                    
                    // Stop immediately if count didn't change
                    if (newTodayCount === previousTodayCount) {
                        console.log(`--- STAGE 0 CATCH-UP COMPLETE ---: Message count unchanged (${newTodayCount}). Stopping catch-up scrolls.`);
                        break;
                    }
                    
                    // Stop if earliest timestamp unchanged and we have messages
                    if (newEarliestTodayTimestamp && newEarliestTodayTimestamp === previousEarliestInCatchUp && catchUpScrollCount > 1) {
                        console.log(`--- STAGE 0 CATCH-UP COMPLETE ---: Earliest timestamp unchanged. Stopping catch-up scrolls.`);
                        break;
                    }
                    
                    previousTodayCount = newTodayCount;
                    previousEarliestInCatchUp = newEarliestTodayTimestamp;
                }
            } else {
                console.log(`--- STAGE 0 CATCH-UP SKIPPED ---: No messages from today found (0). Skipping catch-up scrolls.`);
            }
            
            // After catch-up scrolls, check if we should continue or stop
            const finalTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
            const finalEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
            
            // If earliest timestamp hasn't changed, we're done
            if (finalEarliestTodayTimestamp === previousEarliestTodayTimestamp) {
                console.log(`--- STAGE 0 COMPLETE ---: Finished loading. Final count: ${finalTodayCount} messages from today. Earliest timestamp unchanged.`);
                break;
            }
            
            // Update tracking for continued scrolling
            previousEarliestTodayTimestamp = finalEarliestTodayTimestamp;
            earliestTimestampUnchangedCount = 0;
        }
        
        // Still loading messages from today - continue normal scrolling
        if (oldestDDMM) {
            console.log(`CTO DEBUG: Oldest message is from ${oldestDDMM}. Today is ${todayDDMM}. Continuing scroll.`);
        } else {
            console.log(`CTO DEBUG: Could not extract date from oldest message. Continuing scroll.`);
        }
    }
    
    // Phase 2: Safety scrolls (only if we exhausted normal scrolls and oldest message is STILL from today)
    if (scrollCount >= MAX_SCROLLS && !dateBoundaryDetected) {
        const oldestDDMM = getOldestMessageDate();
        const currentTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
        
        // Only start safety scrolls if oldest message is still from today (we haven't reached boundary)
        if (oldestDDMM && !isDateNotToday(oldestDDMM, todayDDMM)) {
            const currentEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
            console.log(`--- STAGE 0 STARTING SAFETY SCROLLS ---: After ${scrollCount} normal scrolls, oldest message is still from today (${oldestDDMM}). Starting safety scrolls to catch any lazy-loaded messages.`);
            dateBoundaryDetected = true;
            safetyScrollsRemaining = SAFETY_SCROLLS;
            previousTodayCount = currentTodayCount;
            previousEarliestTodayTimestamp = currentEarliestTodayTimestamp;
        } else {
            // We've reached the boundary during normal scrolling, no safety scrolls needed
            console.log(`--- STAGE 0 COMPLETE ---: Reached date boundary during normal scrolling. No safety scrolls needed.`);
        }
    }
    
    // Phase 3: Execute safety scrolls if needed
    while (dateBoundaryDetected && safetyScrollsRemaining > 0) {
        // Perform the scroll
        console.log(`CTO DEBUG: Safety scroll attempt. Setting scrollTop=0 on element: ${selectorUsed}`);
        chatPanel.scrollTop = 0; 
        scrollCount++;
        console.log(`Safety scrolling attempt ${SAFETY_SCROLLS - safetyScrollsRemaining + 1}/${SAFETY_SCROLLS}. Waiting 2s for new messages to load...`);

        await new Promise(r => setTimeout(r, 2000)); 

        // Collect messages immediately after scroll
        const messageElements = document.querySelectorAll('div[data-pre-plain-text]');
        messageElements.forEach(el => {
            const messageData = extractMessageData(el, todayDDMM);
            if (messageData) {
                collectedMessages.set(messageData.dataAttr, messageData);
            }
        });

        const currentMessageCount = collectedMessages.size;
        const currentTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
        const currentEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
        
        console.log(`Messages after safety scroll: ${currentMessageCount} total in collection, ${currentTodayCount} from today.`);
        console.log(`CTO DEBUG: Earliest timestamp from today: ${currentEarliestTodayTimestamp || 'None'}`);
        
        // Stop immediately if count didn't change
        if (currentTodayCount === previousTodayCount) {
            console.log(`--- STAGE 0 SAFETY SCROLL COMPLETE ---: Message count unchanged (${currentTodayCount}). Stopping safety scrolls.`);
            break;
        }
        
        // Stop if earliest timestamp unchanged
        if (currentEarliestTodayTimestamp && currentEarliestTodayTimestamp === previousEarliestTodayTimestamp) {
            console.log(`--- STAGE 0 SAFETY SCROLL COMPLETE ---: Earliest timestamp unchanged. Stopping safety scrolls.`);
            break;
        }
        
        console.log(`--- STAGE 0 SAFETY SCROLL ${SAFETY_SCROLLS - safetyScrollsRemaining + 1}/${SAFETY_SCROLLS} ---: Today's message count: ${currentTodayCount} (was ${previousTodayCount})`);
        
        previousTodayCount = currentTodayCount;
        previousEarliestTodayTimestamp = currentEarliestTodayTimestamp;
        safetyScrollsRemaining--;
        
        if (safetyScrollsRemaining === 0) {
            console.log(`--- STAGE 0 COMPLETE ---: Safety scrolls completed. Final count: ${currentTodayCount} messages from today.`);
            break;
        }
    }

    const finalCount = collectedMessages.size;
    const finalTodayCount = Array.from(collectedMessages.values()).filter(m => m.isFromToday).length;
    const finalEarliestTodayTimestamp = getEarliestTodayTimestamp(collectedMessages, todayDDMM);
    
    console.log(`--- STAGE 0 COMPLETE ---: Finished after ${scrollCount} scroll attempts. Total messages collected: ${finalCount}, Messages from today: ${finalTodayCount}`);
    console.log(`CTO DEBUG: Earliest timestamp from today: ${finalEarliestTodayTimestamp || 'None'}`);
    
    // Debug: Print the first and last messages from today
    const messagesFromToday = Array.from(collectedMessages.values()).filter(m => m.isFromToday);
    if (messagesFromToday.length > 0) {
        // Sort by timestamp to get the first (earliest) and last (most recent) messages
        const sortedMessages = messagesFromToday.sort((a, b) => a.time.localeCompare(b.time));
        const firstMessage = sortedMessages[0];
        const lastMessage = sortedMessages[sortedMessages.length - 1];
        
        console.log(`--- DEBUG: First message from today ---`);
        console.log(`  Time: ${firstMessage.time}`);
        console.log(`  Sender: ${firstMessage.sender}`);
        console.log(`  Text: ${firstMessage.text.substring(0, 100)}${firstMessage.text.length > 100 ? '...' : ''}`);
        
        console.log(`--- DEBUG: Last message from today ---`);
        console.log(`  Time: ${lastMessage.time}`);
        console.log(`  Sender: ${lastMessage.sender}`);
        console.log(`  Text: ${lastMessage.text.substring(0, 100)}${lastMessage.text.length > 100 ? '...' : ''}`);
    } else {
        console.log(`--- DEBUG: No messages from today found.`);
    }
}


// Function 3: Scrape messages from the currently open chat (FINAL LOGIC)
async function getMessages() {
    // 1. First, scroll and load the full message history
    await loadFullHistory();
    
    // 2. Use the collected messages (already extracted during scrolling)
    const allCollectedMessages = Array.from(collectedMessages.values());
    const allMessages = allCollectedMessages.map(m => ({
        sender: m.sender,
        time: m.time,
        text: m.text
    }));
    const messagesFromToday = allCollectedMessages
        .filter(m => m.isFromToday)
        .map(m => ({
            sender: m.sender,
            time: m.time,
            text: m.text
        }));

    console.log(`--- STAGE 2 (Filtering) ---: Using ${allMessages.length} collected messages, ${messagesFromToday.length} from today.`);
    
    // Debug: Print the last message from today
    if (messagesFromToday.length > 0) {
        // Sort by timestamp to get the last (most recent) message
        const sortedMessages = [...messagesFromToday].sort((a, b) => b.time.localeCompare(a.time));
        const lastMessage = sortedMessages[0];
        console.log(`--- DEBUG: Last message from today ---`);
        console.log(`  Time: ${lastMessage.time}`);
        console.log(`  Sender: ${lastMessage.sender}`);
        console.log(`  Text: ${lastMessage.text.substring(0, 100)}${lastMessage.text.length > 100 ? '...' : ''}`);
    } else {
        console.log(`--- DEBUG: No messages from today found.`);
    }
    
    // Old scraping code removed - using collected messages instead
    /* messageElements.forEach(el => {
        let rawTimestamp = 'Unknown Time';
        let sender = 'You'; 
        
        const attr = el.getAttribute('data-pre-plain-text');
        
        if (attr) {
             const match = attr.match(/\[(.*?)\] (.*?):/);
             if (match) {
                 rawTimestamp = match[1].trim(); 
                 sender = match[2].trim();      
             } else {
                 const timeMatch = attr.match(/\[(.*?)\]/);
                 rawTimestamp = timeMatch ? timeMatch[1].trim() : 'Unknown Time';
             }
        }
        
        // Extract date from timestamp to check if it's from today
        const messageDDMM = extractDDMMFromTimestamp(rawTimestamp);
        const isFromToday = messageDDMM && isDateToday(messageDDMM, todayDDMM);
        
        // CTO FIX 2: ROBUST TEXT EXTRACTION
        // Instead of relying on fragile CSS classes, we get the element's full text 
        // and remove the header (timestamp + sender) which is reliably in the attribute.
        
        // 1. Find the full raw text content of the message wrapper element.
        let fullText = el.textContent || '';
        
        // 2. Extract the prefix that needs to be removed from the data attribute.
        // The data attribute text is always: "[TIMESTAMP] SENDER: " (or similar)
        const prefix = el.getAttribute('data-pre-plain-text') || '';
        
        // 3. Remove the prefix and any invisible characters (like RTL marker) from the text.
        let messageText = fullText.replace(prefix, '').replace(/\u200e/g, '').trim(); 

        
        if (messageText) {
            const message = {
                sender: sender,
                time: rawTimestamp, 
                text: messageText,
            };
            
            allMessages.push(message);
            
            // Only include messages from today
            if (isFromToday) {
                messagesFromToday.push(message);
            }
        }
    }); */

    // console.log(`--- STAGE 2 (Filtering) ---: Scraped ${allMessages.length} total messages, ${messagesFromToday.length} from today.`);
    
    // Debug: Print the first and last messages from today
    if (messagesFromToday.length > 0) {
        // Sort by timestamp to get the first (earliest) and last (most recent) messages
        const sortedMessages = [...messagesFromToday].sort((a, b) => a.time.localeCompare(b.time));
        const firstMessage = sortedMessages[0];
        const lastMessage = sortedMessages[sortedMessages.length - 1];
        
        console.log(`--- DEBUG: First message from today ---`);
        console.log(`  Time: ${firstMessage.time}`);
        console.log(`  Sender: ${firstMessage.sender}`);
        console.log(`  Text: ${firstMessage.text.substring(0, 100)}${firstMessage.text.length > 100 ? '...' : ''}`);
        
        console.log(`--- DEBUG: Last message from today ---`);
        console.log(`  Time: ${lastMessage.time}`);
        console.log(`  Sender: ${lastMessage.sender}`);
        console.log(`  Text: ${lastMessage.text.substring(0, 100)}${lastMessage.text.length > 100 ? '...' : ''}`);
    } else {
        console.log(`--- DEBUG: No messages from today found.`);
    }
    
    return messagesFromToday;
}

// Function 3.1: Get messages for question answering (uses all messages if no messages from today)
async function getMessagesForQuestion() {
    // 1. First, scroll and load the full message history
    await loadFullHistory();
    
    // 2. Use the collected messages (already extracted during scrolling)
    const allCollectedMessages = Array.from(collectedMessages.values());
    const allMessages = allCollectedMessages.map(m => ({
        sender: m.sender,
        time: m.time,
        text: m.text
    }));
    const messagesFromToday = allCollectedMessages
        .filter(m => m.isFromToday)
        .map(m => ({
            sender: m.sender,
            time: m.time,
            text: m.text
        }));

    console.log(`[Question] Using ${allMessages.length} total messages, ${messagesFromToday.length} from today.`);
    
    // For questions: if there are messages from today, use those; otherwise use all messages
    const messagesToUse = messagesFromToday.length > 0 ? messagesFromToday : allMessages;
    
    if (messagesToUse.length === 0) {
        console.warn(`[Question] No messages found at all for this chat.`);
    } else if (messagesFromToday.length === 0) {
        console.log(`[Question] No messages from today, using all ${allMessages.length} available messages.`);
    }
    
    return messagesToUse;
}


// --- 3. IPC Command Listeners (Handle Commands from Main) ---

// Listener 1: Main asks for the chat list (UI: schedule message / summary)
ipcRenderer.on('app:request-chat-list', async () => {
    const list = await getChatList();
    ipcRenderer.send('whatsapp:response-chat-list', list);
});

// Listener 1b: Main asks for chat list for name resolution only (background; same getChatList(), never sent to UI)
ipcRenderer.on('app:request-chat-list-for-resolve', async () => {
    const list = await getChatList();
    ipcRenderer.send('whatsapp:chat-list-for-resolve', list);
});

// Listener 2: Main asks to click a chat
ipcRenderer.on('app:command-click-chat', (event, targetName) => {
    clickChat(targetName);
});

// Listener 3: Main asks for the messages
ipcRenderer.on('app:request-messages', async () => {
    const messages = await getMessages();
    ipcRenderer.send('whatsapp:response-messages', messages);
});

// Listener 4: Main asks to send a message
ipcRenderer.on('app:command-send-message', async (event, { chatName, messageText }) => {
    try {
        // First, open the chat
        await clickChat(chatName);
        
        // Wait a bit for chat to open
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Find the message input field and send the message
        const success = await sendMessage(messageText);
        
        if (success) {
            ipcRenderer.send('whatsapp:message-sent', { chatName, success: true });
        } else {
            ipcRenderer.send('whatsapp:message-sent', { chatName, success: false, error: 'Could not find message input field' });
        }
    } catch (error) {
        console.error('[Preload] Error sending message:', error);
        ipcRenderer.send('whatsapp:message-sent', { chatName, success: false, error: error.message });
    }
});

// Listener 5: Main asks to answer a question for a chat
ipcRenderer.on('app:command-answer-question', async (event, { chatName, question }) => {
    console.log(`[Preload] Received question command for chat: "${chatName}", question: "${question}"`);
    try {
        // First, open the chat
        const chatResult = await clickChat(chatName);
        if (!chatResult || (typeof chatResult === 'object' && chatResult.success === false)) {
            const errorMsg = typeof chatResult === 'object' && chatResult.error 
                ? chatResult.error 
                : `Could not open chat: ${chatName}`;
            throw new Error(errorMsg);
        }
        
        // Wait for chat to open and messages to load (longer wait for message extraction)
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Extract messages for question answering (uses all messages if no messages from today)
        const messages = await getMessagesForQuestion();
        
        console.log(`[Preload] Extracted ${messages.length} messages for question answering`);
        
        // Send messages and question back to main process (even if 0 messages, let API handle it)
        ipcRenderer.send('whatsapp:messages-for-question', {
            chatName: chatName,
            question: question,
            messages: messages
        });
    } catch (error) {
        console.error('[Preload] Error processing question:', error);
        ipcRenderer.send('whatsapp:question-answered', {
            chatName: chatName,
            answer: null,
            success: false,
            error: error.message
        });
    }
});


// --- 4. Readiness Check ---
function checkWhatsAppLoaded() {
    const chatListContainer = document.querySelector('[aria-label="רשימת צ\'אטים"], [aria-label="Chat list"]'); 
    
    if (chatListContainer) {
        console.log("Preload: Chat List Container found! Sending 'ready' signal to Main process.");
        ipcRenderer.send('whatsapp:ready');
        clearInterval(loadCheckInterval);
    }
}

const loadCheckInterval = setInterval(checkWhatsAppLoaded, 2000); 

console.log("Preload script loaded successfully.");