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
let summaryFlowChatList = [];
let lastChatListForMessage = [];
/** True only while we requested the chat list for schedule-message flow and haven't received it yet. Prevents stray main:render-chat-list-for-message from overwriting other screens. */
let waitingForChatListForMessage = false;
/** True only while we requested the chat list for in-app question flow. */
let waitingForChatListForQuestion = false;

// --- i18n ---
const TRANSLATIONS = {
    loadingApp: { en: 'Loading Application...', he: 'טוען את האפליקציה...' },
    checkingLogin: { en: 'Checking login status and configuration.', he: 'בודק סטטוס התחברות והגדרות.' },
    loadingChats: { en: 'Loading Your Chats...', he: 'טוען את הצ\'אטים...' },
    searchingChats: { en: 'Searching through your WhatsApp chats. This may take a few seconds...', he: 'מחפש בצ\'אטים של וואטסאפ. זה עלול לקחת כמה שניות...' },
    initializing: { en: 'Initializing...', he: 'מאתחל...' },
    connectingWhatsApp: { en: 'Connecting to WhatsApp...', he: 'מתחבר לווואטסאפ...' },
    scanningChatList: { en: 'Scanning chat list...', he: 'סורק רשימת צ\'אטים...' },
    collectingNames: { en: 'Collecting chat names...', he: 'אוסף שמות צ\'אטים...' },
    finalizing: { en: 'Finalizing...', he: 'מסיים...' },
    hello: { en: 'Hello 👋', he: 'שלום 👋' },
    scanQR: { en: 'Please scan the QR code to connect to WhatsApp.', he: 'נא לסרוק את קוד ה-QR כדי להתחבר לווואטסאפ.' },
    afterConnect: { en: 'After that, you can minimize this window and enjoy your daily brief directly in WhatsApp.', he: 'אחר כך תוכל למזער את החלון וליהנות מהתקציר היומי ישירות בווואטסאפ.' },
    qrAppear: { en: 'The QR code will appear in the WhatsApp window. Once connected, this window will automatically hide.', he: 'קוד ה-QR יופיע בחלון הווואטסאפ. לאחר ההתחברות, החלון יוסתר אוטומטית.' },
    settings: { en: '⚙️ Settings', he: '⚙️ הגדרות' },
    enterPhone: { en: 'Please enter your phone number', he: 'נא להזין את מספר הטלפון שלך' },
    appearance: { en: 'Appearance', he: 'מראה' },
    light: { en: 'Light', he: 'בהיר' },
    dark: { en: 'Dark', he: 'כהה' },
    language: { en: 'Language', he: 'שפה' },
    english: { en: 'English', he: 'English' },
    hebrew: { en: 'Hebrew', he: 'עברית' },
    showHideWhatsApp: { en: 'Show/Hide WhatsApp', he: 'הצג/הסתר וואטסאפ' },
    backToDashboard: { en: '← Back to Dashboard', he: '← חזרה ללוח הבקרה' },
    backToDashboardShort: { en: 'Back to Dashboard', he: 'חזרה ללוח הבקרה' },
    saveSettings: { en: 'Save Settings', he: 'שמור הגדרות' },
    settingsSaved: { en: 'Settings saved.', he: 'ההגדרות נשמרו.' },
    noChatsFound: { en: 'No Chats Found', he: 'לא נמצאו צ\'אטים' },
    noChatsFoundEmoji: { en: '❌ No Chats Found', he: '❌ לא נמצאו צ\'אטים' },
    ensureLoggedIn: { en: 'Please ensure you are logged into WhatsApp Web and try again.', he: 'נא לוודא שהתחברת לווואטסאפ ווב ולנסות שוב.' },
    showWhatsAppWindow: { en: 'Show WhatsApp Window', he: 'הצג חלון וואטסאפ' },
    retryFindingChats: { en: 'Retry Finding Chats', he: 'נסה שוב למצוא צ\'אטים' },
    selectChatsDailyBrief: { en: 'Select Chats for Daily Brief', he: 'בחר צ\'אטים לתקציר יומי' },
    searchChats: { en: '🔍 Search chats...', he: '🔍 חפש צ\'אטים...' },
    nextConfigureSchedules: { en: 'Next: Configure Schedules', he: 'הבא: הגדר זמנים' },
    setDailyBriefSchedules: { en: 'Set Daily Brief Schedules', he: 'הגדר זמנים לתקציר יומי' },
    saveStartAutomation: { en: 'Save & Start Automation', he: 'שמור והפעל אוטומציה' },
    editScheduleFor: { en: '✏️ Edit Schedule for:', he: '✏️ ערוך זמנים עבור:' },
    saveSchedule: { en: 'Save Schedule', he: 'שמור זמנים' },
    chooseWhoSendMessage: { en: 'Choose to who you want to send the message', he: 'בחר למי לשלוח את ההודעה' },
    scheduleMessageScreenTitle: { en: 'Choose who you want to send the message to and when it will be sent', he: 'בחר למי לשלוח את ההודעה ומתי לשלוח' },
    refreshChats: { en: 'Refresh chats', he: 'רענן צ\'אטים' },
    nextConfigureWhen: { en: 'Next: Configure when to send the message', he: 'הבא: הגדר מתי לשלוח את ההודעה' },
    chooseChatToSummarize: { en: 'Choose a chat to summarize', he: 'בחר צ\'אט לסכם' },
    nextSummaryOptions: { en: 'Next: Choose summary options', he: 'הבא: בחר אפשרויות תקציר' },
    summaryOptionsFor: { en: 'Summary options for:', he: 'אפשרויות תקציר עבור:' },
    back: { en: '← Back', he: '← חזרה' },
    generateSummary: { en: 'Generate Summary', he: 'צור תקציר' },
    generatingSummary: { en: 'Generating Summary...', he: 'מייצר תקציר...' },
    readingSummarizing: { en: 'Reading messages and summarizing. This may take a moment.', he: 'קורא הודעות ומסכם. זה יקח כמה שניות...' },
    openingChat: { en: 'Opening chat...', he: 'פותח צ\'אט...' },
    readingMessages: { en: 'Reading messages...', he: 'קורא הודעות...' },
    summarizing: { en: 'Summarizing...', he: 'מסכם...' },
    summary: { en: 'Summary', he: 'תקציר' },
    copyToClipboard: { en: 'Copy to clipboard', he: 'העתק ללוח' },
    noMessagesForChat: { en: 'No messages found for the selected chat.', he: 'לא נמצאו הודעות לצ\'אט שנבחר.' },
    noSummaryGenerated: { en: 'No summary generated.', he: 'לא נוצר תקציר.' },
    configureWhenSend: { en: 'Configure when to send the message', he: 'הגדר מתי לשלוח את ההודעה' },
    selectDateTime: { en: 'Select the date and time when you want to send the message to', he: 'בחר את התאריך והשעה לשליחת ההודעה ל' },
    date: { en: 'Date:', he: 'תאריך:' },
    time: { en: 'Time:', he: 'שעה:' },
    next: { en: 'Next', he: 'הבא' },
    typeYourMessage: { en: 'Type your message', he: 'הקלד את ההודעה' },
    enterMessageSendTo: { en: 'Enter the message you want to send to', he: 'הזן את ההודעה שברצונך לשלוח ל' },
    messageWillBeSentTo: { en: 'The message will be sent to', he: 'ההודעה תישלח ל' },
    messageSentToOnDateAtTime: { en: 'on {date} at {time}.', he: 'בתאריך {date} בשעה {time}.' },
    typeMessagePlaceholder: { en: 'Type your message here...', he: 'הקלד את ההודעה כאן...' },
    save: { en: 'Save', he: 'שמור' },
    scheduleMessage: { en: 'Schedule Message', he: 'תזמן הודעה' },
    summarize: { en: 'Summarize', he: 'סכם' },
    scheduledMessages: { en: 'Scheduled Messages', he: 'הודעות מתוזמנות' },
    noMessagesScheduled: { en: 'No messages are currently scheduled.', he: 'אין הודעות מתוזמנות כרגע.' },
    editMessage: { en: 'Edit message', he: 'ערוך הודעה' },
    deleteMessage: { en: 'Delete message', he: 'מחק הודעה' },
    chat: { en: 'Chat', he: 'צ\'אט' },
    categorySummary: { en: 'Summary', he: 'תקציר' },
    categoryTasks: { en: 'Tasks', he: 'משימות' },
    categoryDates: { en: 'Dates', he: 'תאריכים' },
    categoryDecisions: { en: 'Decisions', he: 'החלטות' },
    categoryUpdates: { en: 'Critical Updates', he: 'עדכונים קריטיים' },
    noChatsMatchSearch: { en: 'No chats match your search.', he: 'אין צ\'אטים התואמים לחיפוש.' },
    noChatsToSchedule: { en: 'No chats to schedule. Please go back and select chats.', he: 'אין צ\'אטים לתזמון. נא לחזור ולבחור צ\'אטים.' },
    pleaseEnterPhone: { en: 'Please enter your phone number.', he: 'נא להזין את מספר הטלפון שלך.' },
    confirmDeleteMessage: { en: 'Are you sure you want to delete the scheduled message to', he: 'האם אתה בטוח שברצונך למחוק את ההודעה המתוזמנת ל' },
    copiedToClipboard: { en: 'Copied to clipboard.', he: 'הועתק ללוח.' },
    copyFailed: { en: 'Copy failed.', he: 'ההעתקה נכשלה.' },
    statusConnected: { en: 'Connected', he: 'מחובר' },
    statusConnecting: { en: 'Connecting...', he: 'מתחבר...' },
    statusDisconnected: { en: 'Disconnected', he: 'מנותק' },
    askQuestion: { en: 'Ask a question', he: 'שאל שאלה' },
    askQuestionAboutChat: { en: 'Ask a question about a chat', he: 'שאל שאלה על צ\'אט' },
    chooseChatToAsk: { en: 'Choose a chat to ask about', he: 'בחר צ\'אט לשאול עליו' },
    typeYourQuestion: { en: 'Type your question...', he: 'הקלד את השאלה שלך...' },
    sendQuestion: { en: 'Send', he: 'שלח' },
    clickChatSendMessage: { en: 'Click on the chat you want to send a scheduled message to.', he: 'לחץ על הצ\'אט שאליו תרצה לשלוח הודעה מתוזמנת.' },
    clickChatSummarize: { en: 'Click on the chat you want to summarize.', he: 'לחץ על הצ\'אט שברצונך לסכם.' },
    selectSectionsSummary: { en: 'Select the sections to include in the summary. Leave all unchecked for full summary.', he: 'בחר את הסעיפים לכלול בסיכום. השאר הכל לא מסומן לסיכום מלא.' },
    showWhatsApp: { en: 'Show WhatsApp', he: 'הצג וואטסאפ' },
    hideWhatsApp: { en: 'Hide WhatsApp', he: 'הסתר וואטסאפ' },
    status: { en: 'Status', he: 'סטטוס' },
};
let currentLanguage = 'en';

function t(key) {
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    return entry[currentLanguage] || entry.en || key;
}

function applyLanguage(lang) {
    const l = (lang === 'he' || lang === 'en') ? lang : 'en';
    currentLanguage = l;
    const root = document.documentElement;
    root.setAttribute('lang', l);
    root.setAttribute('dir', l === 'he' ? 'rtl' : 'ltr');
}

function getCurrentLanguage() {
    return currentLanguage;
} 


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
            <h2>${t('loadingApp')}</h2>
            <p>${t('checkingLogin')}</p>
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
            <h2>${t('loadingChats')}</h2>
            <p>${t('searchingChats')}</p>
            <div class="progress-bar-container">
                <div class="progress-bar" id="chat-list-progress-bar"></div>
            </div>
            <p class="loading-text" id="chat-list-loading-text">${t('initializing')}</p>
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
                loadingText.textContent = t('connectingWhatsApp');
            } else if (progress < 50) {
                loadingText.textContent = t('scanningChatList');
            } else if (progress < 75) {
                loadingText.textContent = t('collectingNames');
            } else {
                loadingText.textContent = t('finalizing');
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
            <h2 style="font-size: 28px; margin-bottom: 20px;">${t('hello')}</h2>
            <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px; color: #666;">
                ${t('scanQR')}<br>
                ${t('afterConnect')}
            </p>
            <div style="margin-top: 30px; padding: 20px; background-color: #f5f5f5; border-radius: 8px;">
                <p style="color: #666; font-size: 14px;">
                    ${t('qrAppear')}
                </p>
            </div>
        </div>
    `;
}


// --- 3. UI Step - Delivery Configuration (UPDATED) ---
// Helper: get status label for Settings screen
function getWhatsAppStatusLabel(status) {
    if (status === 'connected') return t('statusConnected');
    if (status === 'disconnected') return t('statusDisconnected');
    return t('statusConnecting');
}
// Update WhatsApp status indicator (dot + label in Settings when visible)
function updateWhatsAppStatus(status) {
    const led = document.getElementById('status-led');
    if (led) {
        led.classList.remove('status-led-connected', 'status-led-connecting', 'status-led-disconnected');
        led.classList.add(status === 'connected' ? 'status-led-connected' : (status === 'disconnected' ? 'status-led-disconnected' : 'status-led-connecting'));
    }
    const label = document.getElementById('status-led-label');
    if (label) label.textContent = getWhatsAppStatusLabel(status);
}

function applyTheme(theme) {
    const t = (theme === 'light' || theme === 'dark') ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', t);
}

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

/** Update all translated strings on the settings screen (so Hebrew/RTL works when language changes). */
function updateSettingsScreenTranslations() {
    const byId = (id) => document.getElementById(id);
    const set = (id, text) => { const el = byId(id); if (el) el.textContent = text; };
    set('settings-heading', t('settings'));
    set('settings-enter-phone', t('enterPhone'));
    set('settings-label-appearance', t('appearance'));
    set('settings-label-language', t('language'));
    set('settings-label-status', t('status'));
    const lightBtn = byId('theme-light-btn');
    const darkBtn = byId('theme-dark-btn');
    if (lightBtn) lightBtn.textContent = t('light');
    if (darkBtn) darkBtn.textContent = t('dark');
    const enBtn = byId('lang-en-btn');
    const heBtn = byId('lang-he-btn');
    if (enBtn) enBtn.textContent = t('english');
    if (heBtn) heBtn.textContent = t('hebrew');
    const statusLabel = byId('status-led-label');
    if (statusLabel) statusLabel.textContent = getWhatsAppStatusLabel(window.whatsappConnectionStatus || 'connecting');
    const toggleBtn = byId('toggle-whatsapp-button');
    if (toggleBtn) {
        toggleBtn.textContent = window.whatsappWindowVisible ? t('hideWhatsApp') : t('showWhatsApp');
        toggleBtn.title = toggleBtn.textContent;
    }
}

function renderDeliverySetup(isInitialSetup = true) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    waitingForChatListForMessage = false;
    isTestRunning = false; 

    const currentTheme = getCurrentTheme();
    const currentLang = getCurrentLanguage();
    // Simplified delivery setup - phone number + Theme + Language + Show/Hide WhatsApp
    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2 id="settings-heading">${t('settings')}</h2>
            <p id="settings-enter-phone">${t('enterPhone')}</p>
            <input type="text" id="recipient-phone-number" placeholder="+972..." dir="auto" />
            <div class="settings-theme-row" style="margin-top: 20px; margin-bottom: 12px;">
                <label id="settings-label-appearance" style="font-weight: 600; margin-inline-end: 12px;">${t('appearance')}</label>
                <div class="theme-toggle" style="display: inline-flex; gap: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--secondary-border);">
                    <button type="button" id="theme-light-btn" class="theme-toggle-btn ${currentTheme === 'light' ? 'active' : ''}" data-theme="light" style="padding: 8px 16px; border: none; background: ${currentTheme === 'light' ? 'var(--secondary-bg)' : 'transparent'}; color: var(--secondary-color); font-weight: 500; cursor: pointer;">${t('light')}</button>
                    <button type="button" id="theme-dark-btn" class="theme-toggle-btn ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" style="padding: 8px 16px; border: none; background: ${currentTheme === 'dark' ? 'var(--secondary-bg)' : 'transparent'}; color: var(--secondary-color); font-weight: 500; cursor: pointer;">${t('dark')}</button>
                </div>
            </div>
            <div class="settings-theme-row" style="margin-bottom: 16px;">
                <label id="settings-label-language" style="font-weight: 600; margin-inline-end: 12px;">${t('language')}</label>
                <div class="theme-toggle" style="display: inline-flex; gap: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--secondary-border);">
                    <button type="button" id="lang-en-btn" class="theme-toggle-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en" style="padding: 8px 16px; border: none; background: ${currentLang === 'en' ? 'var(--secondary-bg)' : 'transparent'}; color: var(--secondary-color); font-weight: 500; cursor: pointer;">${t('english')}</button>
                    <button type="button" id="lang-he-btn" class="theme-toggle-btn ${currentLang === 'he' ? 'active' : ''}" data-lang="he" style="padding: 8px 16px; border: none; background: ${currentLang === 'he' ? 'var(--secondary-bg)' : 'transparent'}; color: var(--secondary-color); font-weight: 500; cursor: pointer;">${t('hebrew')}</button>
                </div>
            </div>
            <div class="settings-theme-row" style="margin-bottom: 8px;">
                <label id="settings-label-status" style="font-weight: 600; margin-inline-end: 12px;">${t('status')}</label>
            </div>
            <div class="settings-status-row" style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
                <span id="status-led" class="status-led ${window.whatsappConnectionStatus === 'connected' ? 'status-led-connected' : (window.whatsappConnectionStatus === 'disconnected' ? 'status-led-disconnected' : 'status-led-connecting')}" aria-hidden="true"></span>
                <span id="status-led-label" style="font-size: 14px; color: var(--secondary-color);">${getWhatsAppStatusLabel(window.whatsappConnectionStatus || 'connecting')}</span>
            </div>
            <div id="delivery-status-message" class="status-message" style="margin-top: 10px; color: red;"></div>
            <div class="settings-whatsapp-row">
                <button id="toggle-whatsapp-button" class="secondary-button" title="">${t('showWhatsApp')}</button>
            </div>
        </div>
    `;
    
    const phoneInput = document.getElementById('recipient-phone-number');

    const toggleWhatsAppBtn = document.getElementById('toggle-whatsapp-button');
    toggleWhatsAppBtn.addEventListener('click', () => {
        window.uiApi.sendData('ui:toggle-whatsapp-window');
    });
    window.uiApi.sendData('ui:request-whatsapp-visibility');

    // Theme toggle
    const themeLightBtn = document.getElementById('theme-light-btn');
    const themeDarkBtn = document.getElementById('theme-dark-btn');
    function setThemeActive(theme) {
        applyTheme(theme);
        if (themeLightBtn) {
            themeLightBtn.classList.toggle('active', theme === 'light');
            themeLightBtn.style.background = theme === 'light' ? 'var(--secondary-bg)' : 'transparent';
        }
        if (themeDarkBtn) {
            themeDarkBtn.classList.toggle('active', theme === 'dark');
            themeDarkBtn.style.background = theme === 'dark' ? 'var(--secondary-bg)' : 'transparent';
        }
        window.uiApi.sendData('ui:save-theme', theme);
    }
    themeLightBtn && themeLightBtn.addEventListener('click', () => setThemeActive('light'));
    themeDarkBtn && themeDarkBtn.addEventListener('click', () => setThemeActive('dark'));

    // Language toggle
    const langEnBtn = document.getElementById('lang-en-btn');
    const langHeBtn = document.getElementById('lang-he-btn');
    function setLanguageActive(lang) {
        applyLanguage(lang);
        if (langEnBtn) { langEnBtn.classList.toggle('active', lang === 'en'); langEnBtn.style.background = lang === 'en' ? 'var(--secondary-bg)' : 'transparent'; }
        if (langHeBtn) { langHeBtn.classList.toggle('active', lang === 'he'); langHeBtn.style.background = lang === 'he' ? 'var(--secondary-bg)' : 'transparent'; }
        window.uiApi.sendData('ui:save-language', lang);
        updateSettingsScreenTranslations();
    }
    langEnBtn && langEnBtn.addEventListener('click', () => setLanguageActive('en'));
    langHeBtn && langHeBtn.addEventListener('click', () => setLanguageActive('he'));
    
    // Load existing settings (phone, theme, language)
    if (!isInitialSetup) {
        window.uiApi.sendData('ui:request-delivery-settings');
    }
    
    // Auto-save phone number when user leaves the field (theme/language already save on click)
    function sendPhoneSettings() {
        const recipientPhoneNumber = (phoneInput && phoneInput.value) ? phoneInput.value.trim() : '';
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
        window.uiApi.sendData('ui:save-delivery-settings', settings);
    }
    if (phoneInput) {
        phoneInput.addEventListener('blur', sendPhoneSettings);
        let phoneSaveTimeout;
        phoneInput.addEventListener('input', () => {
            clearTimeout(phoneSaveTimeout);
            phoneSaveTimeout = setTimeout(sendPhoneSettings, 800);
        });
    }
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
                <h2>${t('noChatsFoundEmoji')}</h2>
                <p>${t('ensureLoggedIn')}</p>
                <div style="margin-top: 20px; display: flex; gap: 10px;">
                    <button onclick="window.uiApi.sendData('ui:toggle-whatsapp-window')" class="secondary-button">${t('showWhatsAppWindow')}</button>
                    <button id="retry-chat-list" class="primary-button">${t('retryFindingChats')}</button>
                    ${isSetupComplete ? `<button id="back-to-dashboard-if-setup" class="secondary-button">${t('backToDashboardShort')}</button>` : ''}
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
            <h2>${t('selectChatsDailyBrief')}</h2>
            ${isSetupComplete ? `<button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>` : ''}
        </div>
        <p>Click on the chats you want to schedule for daily brief. Selected chats have a green background. Unselecting a chat will remove its schedule.</p>
        <div style="margin: 15px 0;">
            <input type="text" id="chat-search-input" placeholder="${t('searchChats')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container"></div>
        <button id="next-button" class="primary-button" ${selectedChatNames.size === 0 ? 'disabled' : ''}>${t('nextConfigureSchedules')}</button>
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
            container.innerHTML = `<p style="color: var(--muted-color); padding: 20px; text-align: center;">${t('noChatsMatchSearch')}</p>`;
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
            <h2>${t('setDailyBriefSchedules')}</h2>
            <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
        </div>
        <p>Set the time for the daily brief to be generated for each chat.</p>
        <div id="schedule-container"></div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button" class="secondary-button" style="flex: 1;">${t('backToDashboard')}</button>
            <button id="save-schedules-button" class="primary-button" style="flex: 1;">${t('saveStartAutomation')}</button>
        </div>
    `;
    
    const container = document.getElementById('schedule-container');
    
    if (scheduledChats.length === 0) {
        container.innerHTML = `<p style="color: var(--muted-color); padding: 20px;">${t('noChatsToSchedule')}</p>`;
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
        window.uiApi.sendData('ui:request-scheduled-messages');
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
        <h2>${t('editScheduleFor')} ${chatName}</h2>
        <p>Adjust the time for the daily brief for this chat.</p>
        <div id="schedule-container"></div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button" class="secondary-button" style="flex: 1;">${t('backToDashboard')}</button>
            <button id="save-schedules-button" class="primary-button" style="flex: 1;">${t('saveSchedule')}</button>
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

function renderScheduledMessageChatSelection(chatList, preselect = {}) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    
    selectedChatNames.clear();
    lastChatListForMessage = chatList || [];

    const now = new Date();
    const defaultDate = preselect.preselectDate || now.toISOString().split('T')[0];
    const defaultHour = preselect.preselectTime ? preselect.preselectTime.substring(0, 2) : String((now.getHours() + 1) % 24).padStart(2, '0');
    const defaultMinute = preselect.preselectTime ? preselect.preselectTime.substring(3, 5) : String(now.getMinutes()).padStart(2, '0');
    const defaultTime = preselect.preselectTime || `${defaultHour}:${defaultMinute}`;
    
    if (!chatList || chatList.length === 0) {
        mainSetupDiv.innerHTML = `
            <div class="status-box card">
                <div class="empty-state-icon" style="font-size: 56px; margin-bottom: 16px;">💬</div>
                <h2>${t('noChatsFound')}</h2>
                <p class="status-message">${t('ensureLoggedIn')}</p>
                <div style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
                    <button onclick="window.uiApi.sendData('ui:toggle-whatsapp-window')" class="secondary-button">${t('showWhatsAppWindow')}</button>
                    <button id="retry-chat-list" class="primary-button">${t('retryFindingChats')}</button>
                    <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboardShort')}</button>
                </div>
            </div>
        `;
        
        document.getElementById('retry-chat-list').addEventListener('click', () => {
            renderChatListLoadingState();
            window.uiApi.sendData('ui:refresh-chat-list-for-message');
        });

        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
            window.uiApi.sendData('ui:request-scheduled-messages');
        });
        
        return;
    }

    mainSetupDiv.innerHTML = `
        <div class="chat-selection-header" style="margin-bottom: 10px;">
            <h2>${t('scheduleMessageScreenTitle')}</h2>
            <div class="chat-selection-buttons">
                <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                <button id="refresh-chat-list-message-btn" class="secondary-button">${t('refreshChats')}</button>
            </div>
        </div>
        <div style="margin: 10px 0;">
            <input type="text" id="chat-search-input" placeholder="${t('searchChats')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container" style="max-height: 200px; overflow-y: auto; margin-bottom: 10px;"></div>
        <div class="schedule-datetime-row" style="display: flex; gap: 12px; margin: 10px 0; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 0;">
                <label for="message-date" style="display: block; margin-bottom: 5px; font-weight: 600;">${t('date')}</label>
                <input type="date" id="message-date" value="${defaultDate}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
            <div style="flex: 1; min-width: 0;">
                <label for="message-time" style="display: block; margin-bottom: 5px; font-weight: 600;">${t('time')}</label>
                <input type="time" id="message-time" value="${defaultTime}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
        </div>
        <button id="next-button" class="primary-button" disabled>${t('next')}</button>
    `;
    
    const container = document.getElementById('chat-list-container');
    const nextButton = document.getElementById('next-button');
    const searchInput = document.getElementById('chat-search-input');
    const dateInput = document.getElementById('message-date');
    const timeInput = document.getElementById('message-time');
    
    const allChats = [...chatList];
    let selectedChatName = preselect.preselectChat || null;
    
    function renderFilteredChats(filterText = '') {
        container.innerHTML = '';
        const filterLower = filterText.toLowerCase().trim();
        const filteredChats = filterText ? allChats.filter(name => name.toLowerCase().includes(filterLower)) : allChats;
        
        if (filteredChats.length === 0) {
            container.innerHTML = `<p style="color: var(--muted-color); padding: 20px; text-align: center;">${t('noChatsMatchSearch')}</p>`;
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
    nextButton.disabled = !selectedChatName;
    
    searchInput.addEventListener('input', (e) => {
        renderFilteredChats(e.target.value);
    });

    nextButton.addEventListener('click', () => {
        if (!selectedChatName) {
            alert('Please select a chat to send the message to.');
            return;
        }
        const selectedDate = dateInput.value;
        const selectedTime = timeInput.value;
        if (!selectedDate || !selectedTime) {
            alert('Please select both date and time.');
            return;
        }
        const selectedDateTime = new Date(`${selectedDate}T${selectedTime}`);
        const now = new Date();
        if (selectedDateTime <= now) {
            alert('Please select a date and time in the future.');
            return;
        }
        renderScheduledMessageInput(selectedChatName, selectedDate, selectedTime, preselect.existingMessage || null, preselect.editIndex ?? null);
    });

    document.getElementById('refresh-chat-list-message-btn').addEventListener('click', () => {
        waitingForChatListForMessage = true;
        renderChatListLoadingState();
        window.uiApi.sendData('ui:refresh-chat-list-for-message');
    });
    
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
        window.uiApi.sendData('ui:request-scheduled-messages');
    });

    window.uiApi.sendData('ui:auto-hide-whatsapp');
}

// --- 6.6 UI Step - Group Summarization Flow ---

const SUMMARY_CATEGORIES = [
    { key: 'tldr', labelKey: 'categorySummary' },
    { key: 'tasks', labelKey: 'categoryTasks' },
    { key: 'dates', labelKey: 'categoryDates' },
    { key: 'decisions', labelKey: 'categoryDecisions' },
    { key: 'updates', labelKey: 'categoryUpdates' }
];

function renderSummaryLoadingState() {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2>${t('generatingSummary')}</h2>
            <p>${t('readingSummarizing')}</p>
            <div class="progress-bar-container">
                <div class="progress-bar" id="summary-progress-bar" style="width: 0%;"></div>
            </div>
            <p class="loading-text" id="summary-loading-text">${t('initializing')}</p>
        </div>
    `;
    let p = 0;
    const bar = document.getElementById('summary-progress-bar');
    const text = document.getElementById('summary-loading-text');
    const iv = setInterval(() => {
        if (p < 90) {
            p += 1 + Math.random() * 2;
            if (p > 90) p = 90;
            if (bar) bar.style.width = p + '%';
            if (text) {
                if (p < 30) text.textContent = t('openingChat');
                else if (p < 60) text.textContent = t('readingMessages');
                else text.textContent = t('summarizing');
            }
        }
    }, 200);
    window._summaryLoadingInterval = iv;
}

function renderSummaryChatSelection(chatList) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    waitingForChatListForMessage = false;
    summaryFlowChatList = chatList || [];
    selectedChatNames.clear();
    if (!chatList || chatList.length === 0) {
        mainSetupDiv.innerHTML = `
            <div class="status-box card">
                <div class="empty-state-icon" style="font-size: 56px; margin-bottom: 16px;">💬</div>
                <h2>${t('noChatsFound')}</h2>
                <p class="status-message">${t('ensureLoggedIn')}</p>
                <div style="margin-top: 24px; display: flex; gap: 12px;">
                    <button id="retry-summary-chat-list" class="primary-button">${t('retryFindingChats')}</button>
                    <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                </div>
            </div>
        `;
        document.getElementById('retry-summary-chat-list').addEventListener('click', () => {
            renderChatListLoadingState();
            window.uiApi.sendData('ui:refresh-chat-list-for-summary');
        });
        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
            window.uiApi.sendData('ui:request-scheduled-messages');
        });
        return;
    }
    mainSetupDiv.innerHTML = `
        <div class="chat-selection-header">
            <h2>${t('chooseChatToSummarize')}</h2>
            <div class="chat-selection-buttons">
                <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                <button id="refresh-chat-list-summary-btn" class="secondary-button">${t('refreshChats')}</button>
            </div>
        </div>
        <div style="margin: 15px 0;">
            <input type="text" id="chat-search-input" placeholder="${t('searchChats')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container"></div>
        <button id="next-summary-button" class="primary-button" disabled>${t('nextSummaryOptions')}</button>
    `;
    const container = document.getElementById('chat-list-container');
    const nextButton = document.getElementById('next-summary-button');
    const searchInput = document.getElementById('chat-search-input');
    const allChats = [...chatList];
    let selectedChatName = null;
    function renderFilteredChats(filterText = '') {
        container.innerHTML = '';
        const filterLower = (filterText || '').toLowerCase().trim();
        const filtered = filterLower ? allChats.filter(n => n.toLowerCase().includes(filterLower)) : allChats;
        if (filtered.length === 0) {
            container.innerHTML = `<p style="color: var(--muted-color); padding: 20px; text-align: center;">${t('noChatsMatchSearch')}</p>`;
            return;
        }
        filtered.forEach(name => {
            const btn = document.createElement('button');
            btn.id = `chat-btn-${name}`;
            btn.className = 'chat-button' + (selectedChatName === name ? ' selected' : '');
            btn.textContent = name;
            btn.addEventListener('click', () => {
                if (selectedChatName) {
                    const prev = document.getElementById(`chat-btn-${selectedChatName}`);
                    if (prev) prev.classList.remove('selected');
                }
                selectedChatName = name;
                btn.classList.add('selected');
                nextButton.disabled = false;
            });
            container.appendChild(btn);
        });
    }
    renderFilteredChats();
    searchInput.addEventListener('input', (e) => renderFilteredChats(e.target.value));
    nextButton.addEventListener('click', () => {
        if (selectedChatName) renderSummaryCategorySelection(selectedChatName);
        else alert('Please select a chat.');
    });
    document.getElementById('refresh-chat-list-summary-btn').addEventListener('click', () => {
        renderChatListLoadingState();
        window.uiApi.sendData('ui:refresh-chat-list-for-summary');
    });
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
        window.uiApi.sendData('ui:request-scheduled-messages');
    });
    window.uiApi.sendData('ui:auto-hide-whatsapp');
}

// --- In-app Ask a question flow ---
function renderQuestionChatSelection(chatList) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    waitingForChatListForMessage = false;
    if (chatList === null) {
        mainSetupDiv.innerHTML = `
            <div class="chat-selection-header">
                <h2>${t('askQuestionAboutChat')}</h2>
                <div class="chat-selection-buttons">
                    <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                    <button id="refresh-chat-list-question-btn" class="secondary-button">${t('refreshChats')}</button>
                </div>
            </div>
            <p style="margin: 10px 0;">${t('chooseChatToAsk')}</p>
            <div id="chat-list-container" class="chat-selection-container" style="max-height: 240px; overflow-y: auto; padding: 20px; text-align: center; color: var(--muted-color);">${t('loadingChats')}</div>
            <button id="next-question-btn" class="primary-button" disabled style="margin-top: 16px;">${t('next')}</button>
        `;
        document.getElementById('refresh-chat-list-question-btn').addEventListener('click', () => {
            waitingForChatListForQuestion = true;
            window.uiApi.sendData('ui:refresh-chat-list-for-question');
        });
        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => window.uiApi.sendData('ui:request-scheduled-messages'));
        return;
    }
    if (!chatList || chatList.length === 0) {
        mainSetupDiv.innerHTML = `
            <div class="status-box card">
                <div class="empty-state-icon" style="font-size: 56px; margin-bottom: 16px;">💬</div>
                <h2>${t('noChatsFound')}</h2>
                <p class="status-message">${t('ensureLoggedIn')}</p>
                <div style="margin-top: 24px; display: flex; gap: 12px;">
                    <button id="retry-question-chat-list" class="primary-button">${t('retryFindingChats')}</button>
                    <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                </div>
            </div>
        `;
        document.getElementById('retry-question-chat-list').addEventListener('click', () => {
            waitingForChatListForQuestion = true;
            window.uiApi.sendData('ui:refresh-chat-list-for-question');
        });
        document.getElementById('back-to-dashboard-btn').addEventListener('click', () => window.uiApi.sendData('ui:request-scheduled-messages'));
        return;
    }
    mainSetupDiv.innerHTML = `
        <div class="chat-selection-header">
            <h2>${t('askQuestionAboutChat')}</h2>
            <div class="chat-selection-buttons">
                <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
                <button id="refresh-chat-list-question-btn" class="secondary-button">${t('refreshChats')}</button>
            </div>
        </div>
        <p style="margin: 10px 0;">${t('chooseChatToAsk')}</p>
        <div style="margin: 15px 0;">
            <input type="text" id="chat-search-input" placeholder="${t('searchChats')}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
        </div>
        <div id="chat-list-container" class="chat-selection-container" style="max-height: 240px; overflow-y: auto;"></div>
        <button id="next-question-btn" class="primary-button" disabled style="margin-top: 16px;">${t('next')}</button>
    `;
    const container = document.getElementById('chat-list-container');
    const nextBtn = document.getElementById('next-question-btn');
    const searchInput = document.getElementById('chat-search-input');
    const allChats = [...chatList];
    let selectedChatName = null;
    function renderFiltered(filterText) {
        container.innerHTML = '';
        const lower = (filterText || '').toLowerCase().trim();
        const filtered = lower ? allChats.filter(n => n.toLowerCase().includes(lower)) : allChats;
        if (filtered.length === 0) {
            container.innerHTML = `<p style="color: var(--muted-color); padding: 20px; text-align: center;">${t('noChatsMatchSearch')}</p>`;
            return;
        }
        filtered.forEach(name => {
            const btn = document.createElement('button');
            btn.className = 'chat-button' + (selectedChatName === name ? ' selected' : '');
            btn.textContent = name;
            btn.addEventListener('click', () => {
                if (selectedChatName) document.querySelector(`#chat-list-container .chat-button.selected`)?.classList.remove('selected');
                selectedChatName = name;
                btn.classList.add('selected');
                nextBtn.disabled = false;
            });
            container.appendChild(btn);
        });
    }
    renderFiltered();
    searchInput.addEventListener('input', (e) => renderFiltered(e.target.value));
    nextBtn.addEventListener('click', () => {
        if (selectedChatName) renderQuestionChat(selectedChatName);
        else alert('Please select a chat.');
    });
    document.getElementById('refresh-chat-list-question-btn').addEventListener('click', () => {
        waitingForChatListForQuestion = true;
        window.uiApi.sendData('ui:refresh-chat-list-for-question');
    });
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => window.uiApi.sendData('ui:request-scheduled-messages'));
}

function renderQuestionChat(chatName) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    const messages = [];
    mainSetupDiv.innerHTML = `
        <div class="chat-selection-header" style="margin-bottom: 12px;">
            <h2 style="font-size: 1.1rem;">${t('askQuestion')}: ${chatName}</h2>
            <div class="chat-selection-buttons">
                <button id="question-back-btn" class="secondary-button">${t('backToDashboard')}</button>
            </div>
        </div>
        <div id="question-chat-messages" style="flex: 1; min-height: 280px; max-height: 400px; overflow-y: auto; padding: 12px; background: var(--card-bg, #f5f5f5); border-radius: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px;"></div>
        <div style="display: flex; gap: 8px; align-items: flex-end;">
            <textarea id="question-input" placeholder="${t('typeYourQuestion')}" style="flex: 1; min-height: 44px; max-height: 120px; padding: 10px 14px; border: 1px solid var(--card-border, #ddd); border-radius: 10px; font-size: 14px; font-family: inherit; resize: none;" rows="1"></textarea>
            <button id="question-send-btn" class="primary-button" style="flex-shrink: 0;">${t('sendQuestion')}</button>
        </div>
    `;
    const messagesContainer = document.getElementById('question-chat-messages');
    const inputEl = document.getElementById('question-input');
    const sendBtn = document.getElementById('question-send-btn');

    document.getElementById('question-back-btn').addEventListener('click', () => window.uiApi.sendData('ui:request-scheduled-messages'));

    function appendMessage(role, content, isError = false) {
        const div = document.createElement('div');
        div.className = isError ? 'question-msg question-msg-error' : (role === 'user' ? 'question-msg question-msg-user' : 'question-msg question-msg-assistant');
        div.textContent = content;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    sendBtn.addEventListener('click', () => {
        const question = (inputEl.value || '').trim();
        if (!question) return;
        inputEl.value = '';
        appendMessage('user', question);
        const loadingEl = document.createElement('div');
        loadingEl.id = 'question-loading';
        loadingEl.className = 'question-msg question-msg-assistant';
        loadingEl.textContent = '...';
        loadingEl.style.color = 'var(--muted-color)';
        messagesContainer.appendChild(loadingEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        inputEl.disabled = true;
        sendBtn.disabled = true;
        window.uiApi.sendData('ui:ask-question-in-app', { chatName, question });
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });
}

function renderSummaryCategorySelection(chatName) {
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    mainSetupDiv.innerHTML = `
        <div class="chat-selection-header">
            <h2>${t('summaryOptionsFor')} ${chatName}</h2>
            <div class="chat-selection-buttons">
                <button id="back-summary-categories-btn" class="secondary-button">${t('back')}</button>
            </div>
        </div>
        <p>${t('selectSectionsSummary')}</p>
        <div class="summary-categories-list" style="margin: 20px 0;">
            ${SUMMARY_CATEGORIES.map(c => `
                <label class="summary-category-item">
                    <input type="checkbox" class="summary-category-checkbox" data-key="${c.key}">
                    <span>${t(c.labelKey)}</span>
                </label>
            `).join('')}
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="generate-summary-btn" class="primary-button">${t('generateSummary')}</button>
        </div>
    `;
    document.getElementById('back-summary-categories-btn').addEventListener('click', () => {
        renderSummaryChatSelection(summaryFlowChatList);
    });
    document.getElementById('generate-summary-btn').addEventListener('click', () => {
        const checkboxes = mainSetupDiv.querySelectorAll('.summary-category-checkbox:checked');
        const components = Array.from(checkboxes).map(cb => cb.dataset.key);
        if (window._summaryLoadingInterval) {
            clearInterval(window._summaryLoadingInterval);
            window._summaryLoadingInterval = null;
        }
        renderSummaryLoadingState();
        window.uiApi.sendData('ui:request-summary-from-ui', { chatName, summaryComponents: components.length > 0 ? components : null });
    });
}

function renderSummaryResult(summary, chatName) {
    if (window._summaryLoadingInterval) {
        clearInterval(window._summaryLoadingInterval);
        window._summaryLoadingInterval = null;
    }
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (!mainSetupDiv) return;
    const rawSummary = (summary && typeof summary === 'string') ? summary : (summary || '');
    const isNoMessagesFromBackend = rawSummary === 'No messages found for the selected chat.';
    const displaySummary = isNoMessagesFromBackend ? t('noMessagesForChat') : (rawSummary || t('noSummaryGenerated'));
    const isHebrew = /[\u0590-\u05FF]/.test(displaySummary);
    const summaryContentStyle = isHebrew ? 'text-align: right; direction: rtl;' : 'text-align: left;';
    mainSetupDiv.innerHTML = `
        <div class="status-box">
            <h2>${t('summary')}: ${chatName || t('chat')}</h2>
            <div class="summary-result-actions" style="display: flex; gap: 10px; margin-bottom: 15px; justify-content: flex-start;">
                <button id="back-after-summary-btn" class="secondary-button">${t('backToDashboard')}</button>
                <button id="copy-summary-btn" class="primary-button">${t('copyToClipboard')}</button>
            </div>
            <div id="summary-result-content" class="summary-result-content" style="white-space: pre-wrap; max-height: 400px; overflow-y: auto; padding: 15px; border-radius: 8px; ${summaryContentStyle}">${displaySummary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>
    `;
    document.getElementById('copy-summary-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(displaySummary).then(() => alert(t('copiedToClipboard'))).catch(() => alert(t('copyFailed')));
    });
    document.getElementById('back-after-summary-btn').addEventListener('click', () => {
        window.uiApi.sendData('ui:request-scheduled-messages');
    });
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
        <div class="chat-selection-header">
            <h2>${t('configureWhenSend')}</h2>
            <div class="chat-selection-buttons">
                <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
            </div>
        </div>
        <p>${t('selectDateTime')} <strong>${chatName}</strong>.</p>
        <div id="time-selection-container" style="margin: 20px 0;">
            <div style="margin-bottom: 15px;">
                <label for="message-date" style="display: block; margin-bottom: 5px; font-weight: bold;">${t('date')}</label>
                <input type="date" id="message-date" value="${defaultDate}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
            <div style="margin-bottom: 15px;">
                <label for="message-time" style="display: block; margin-bottom: 5px; font-weight: bold;">${t('time')}</label>
                <input type="time" id="message-time" value="${defaultTime}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">
            </div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button-bottom" class="secondary-button" style="flex: 1;">${t('back')}</button>
            <button id="next-button" class="primary-button" style="flex: 1;">${t('next')}</button>
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
        waitingForChatListForMessage = true;
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
        <div class="chat-selection-header">
            <h2>${t('typeYourMessage')}</h2>
            <div class="chat-selection-buttons">
                <button id="back-to-dashboard-btn" class="secondary-button">${t('backToDashboard')}</button>
            </div>
        </div>
        <p>${t('messageWillBeSentTo')} <strong>${chatName}</strong> ${t('messageSentToOnDateAtTime').replace('{date}', date).replace('{time}', time)}</p>
        <div style="margin: 20px 0;">
            <textarea id="message-text" placeholder="${t('typeMessagePlaceholder')}" style="width: 100%; min-height: 150px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; font-family: inherit; resize: vertical;">${existingMessage || ''}</textarea>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="back-button-bottom" class="secondary-button" style="flex: 1;">${t('back')}</button>
            <button id="save-button" class="primary-button" style="flex: 1;">${t('save')}</button>
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
    
    // Back button - go to previous step (chat+date/time selection, or time-only when editing)
    backButtonBottom.addEventListener('click', () => {
        if (editIndex !== null) {
            renderScheduledMessageTimeSelection(chatName, date, time, existingMessage, editIndex);
        } else {
            renderScheduledMessageChatSelection(lastChatListForMessage, { preselectChat: chatName, preselectDate: date, preselectTime: time });
        }
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
    
    waitingForChatListForMessage = false;
    existingScheduledChats = currentSchedules;
    
    mainSetupDiv.innerHTML = `
        <div class="dashboard-header">
            <div id="dashboard-controls" class="dashboard-controls-inline">
                <button id="add-scheduled-message-button" class="primary-button"><span class="btn-icon">🕐</span> ${t('scheduleMessage')}</button>
                <button id="summarize-chat-button" class="primary-button"><span class="btn-icon">✨</span> ${t('summarize')}</button>
                <button id="ask-question-button" class="primary-button"><span class="btn-icon">❓</span> ${t('askQuestion')}</button>
            </div>
            <div class="dashboard-header-right">
                <button id="settings-icon-button" class="settings-icon" title="${t('settings')}">⚙️</button>
            </div>
        </div>

        <div class="dashboard-card" id="scheduled-messages-card">
            <h3 class="card-title">${t('scheduledMessages')}</h3>
            <ul id="scheduled-messages-ul"></ul>
        </div>
    `;

    // Populate scheduled messages list (card + empty state)
    const messagesUl = document.getElementById('scheduled-messages-ul');
    if (existingScheduledMessages.length === 0) {
        messagesUl.innerHTML = `<li class="empty-state" style="list-style: none;"><p class="status-message">${t('noMessagesScheduled')}</p></li>`;
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
                        <strong>${msg.chatName}</strong> <span class="schedule-meta" style="color: var(--muted-color); font-weight: normal;">${dateTime}</span>
                        <p class="schedule-preview" style="color: var(--muted-color-6); font-size: 12px; margin: 5px 0 0 0;">${messagePreview}</p>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="edit-message-button secondary-button" data-message-index="${index}" title="${t('editMessage')}">✏️</button>
                        <button class="delete-message-button secondary-button" data-message-index="${index}" title="${t('deleteMessage')}">🗑️</button>
                    </div>
                </div>
            `;
            messagesUl.appendChild(li);
        });
    }

    // Add dashboard control listeners
    document.getElementById('add-scheduled-message-button').addEventListener('click', () => {
        waitingForChatListForMessage = true;
        window.uiApi.sendData('ui:request-chat-list-for-message');
    });

    document.getElementById('summarize-chat-button').addEventListener('click', () => {
        window.uiApi.sendData('ui:request-chat-list-for-summary');
    });

    document.getElementById('ask-question-button').addEventListener('click', () => {
        renderQuestionChatSelection(null);
        waitingForChatListForQuestion = true;
        window.uiApi.sendData('ui:request-chat-list-for-question');
    });
    
    document.getElementById('settings-icon-button').addEventListener('click', () => {
        renderDeliverySetup(false);
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
            if (message && confirm(`${t('confirmDeleteMessage')} "${message.chatName}"?`)) {
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

    // 2. Confirmation that delivery settings were saved (settings-only UI: stay on settings)
    window.uiApi.receiveCommand('main:delivery-settings-saved', () => {
        const statusMessageElement = document.getElementById('delivery-status-message');
        if (statusMessageElement) {
            statusMessageElement.textContent = 'Settings saved successfully!';
            statusMessageElement.style.color = 'green';
        }
        if (!isTestRunning) {
            setTimeout(() => {
                if (statusMessageElement) statusMessageElement.textContent = '';
            }, 2000);
        }
    });

    // 3. Receive Delivery Settings (for pre-populating inputs when editing)
    window.uiApi.receiveCommand('main:render-delivery-settings', (settings) => {
        const phoneInput = document.getElementById('recipient-phone-number');
        if (phoneInput) {
            phoneInput.value = settings.recipientPhoneNumber || '';
        }
        const theme = (settings && (settings.theme === 'light' || settings.theme === 'dark')) ? settings.theme : 'dark';
        applyTheme(theme);
        const lang = (settings && (settings.language === 'en' || settings.language === 'he')) ? settings.language : 'en';
        applyLanguage(lang);
        const themeLightBtn = document.getElementById('theme-light-btn');
        const themeDarkBtn = document.getElementById('theme-dark-btn');
        if (themeLightBtn) { themeLightBtn.classList.toggle('active', theme === 'light'); themeLightBtn.style.background = theme === 'light' ? 'var(--secondary-bg)' : 'transparent'; }
        if (themeDarkBtn) { themeDarkBtn.classList.toggle('active', theme === 'dark'); themeDarkBtn.style.background = theme === 'dark' ? 'var(--secondary-bg)' : 'transparent'; }
        const langEnBtn = document.getElementById('lang-en-btn');
        const langHeBtn = document.getElementById('lang-he-btn');
        if (langEnBtn) { langEnBtn.classList.toggle('active', lang === 'en'); langEnBtn.style.background = lang === 'en' ? 'var(--secondary-bg)' : 'transparent'; }
        if (langHeBtn) { langHeBtn.classList.toggle('active', lang === 'he'); langHeBtn.style.background = lang === 'he' ? 'var(--secondary-bg)' : 'transparent'; }
        updateSettingsScreenTranslations();
    });

    // Theme (apply on load and when changed from settings)
    window.uiApi.receiveCommand('main:theme', (theme) => {
        applyTheme(theme);
    });

    // Language (apply on load and when changed from settings)
    window.uiApi.receiveCommand('main:language', (lang) => {
        applyLanguage(lang);
    });
    
    // 9. Receive WhatsApp connection status updates
    window.uiApi.receiveCommand('main:whatsapp-status', (status) => {
        window.whatsappConnectionStatus = status;
        updateWhatsAppStatus(status);
    });

    // 9.5. Receive WhatsApp window visibility (for Settings toggle label)
    window.uiApi.receiveCommand('main:whatsapp-window-visible', (visible) => {
        window.whatsappWindowVisible = !!visible;
        const btn = document.getElementById('toggle-whatsapp-button');
        if (btn) {
            btn.textContent = visible ? t('hideWhatsApp') : t('showWhatsApp');
            btn.title = btn.textContent;
        }
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

    // 6. main:render-chat-list is deprecated (was "Select Chats for Daily Brief"). Do not navigate to that screen.
    window.uiApi.receiveCommand('main:render-chat-list', () => {
        if (window.chatListLoadingInterval) {
            clearInterval(window.chatListLoadingInterval);
            window.chatListLoadingInterval = null;
        }
        // Stay on current screen; optionally ensure dashboard is shown
        window.uiApi.sendData('ui:request-scheduled-messages');
    });

    // 6.5. Receive the list of chats for scheduled message flow
    window.uiApi.receiveCommand('main:render-chat-list-for-message', (chatList) => {
        // Complete the progress bar animation if we're on the loading screen
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
        
        // Only show schedule message chat selection if we requested it (user clicked Schedule Message or Refresh in that flow). Prevents this screen from appearing when user is on Settings, Summary, or other screens.
        if (!waitingForChatListForMessage) {
            return;
        }
        waitingForChatListForMessage = false;
        setTimeout(() => {
            if (!document.getElementById('time-selection-container')) {
                renderScheduledMessageChatSelection(chatList);
            }
        }, 0);
    });

    // 6.6 Receive chat list for summary flow
    window.uiApi.receiveCommand('main:render-chat-list-for-summary', (chatList) => {
        if (window.chatListLoadingInterval) {
            clearInterval(window.chatListLoadingInterval);
            window.chatListLoadingInterval = null;
        }
        const progressBar = document.getElementById('chat-list-progress-bar');
        const loadingText = document.getElementById('chat-list-loading-text');
        if (progressBar) progressBar.style.width = '100%';
        if (loadingText) loadingText.textContent = 'Complete!';
        setTimeout(() => {
            const onSummaryOptions = document.getElementById('generate-summary-btn');
            const onSummaryResult = document.getElementById('summary-result-content');
            const onSummaryLoading = document.getElementById('summary-progress-bar');
            if (!onSummaryOptions && !onSummaryResult && !onSummaryLoading) {
                renderSummaryChatSelection(chatList);
            }
        }, 0);
    });

    // 6.6b Receive chat list for in-app question flow (initial load, refresh, or fresh list after request)
    window.uiApi.receiveCommand('main:render-chat-list-for-question', (chatList) => {
        if (waitingForChatListForQuestion) waitingForChatListForQuestion = false;
        const onQuestionScreen = !!document.getElementById('refresh-chat-list-question-btn');
        if (onQuestionScreen && Array.isArray(chatList)) {
            setTimeout(() => renderQuestionChatSelection(chatList), 0);
        }
    });

    // 6.6c In-app Q&A: answer received from main
    window.uiApi.receiveCommand('main:question-answer-in-app', (data) => {
        const container = document.getElementById('question-chat-messages');
        const loadingEl = document.getElementById('question-loading');
        if (loadingEl) loadingEl.remove();
        if (!container) return;
        if (data.success && data.answer) {
            const div = document.createElement('div');
            div.className = 'question-msg question-msg-assistant';
            div.textContent = data.answer;
            container.appendChild(div);
        } else {
            const errDiv = document.createElement('div');
            errDiv.className = 'question-msg question-msg-error';
            errDiv.textContent = data.error || t('noSummaryGenerated');
            container.appendChild(errDiv);
        }
        container.scrollTop = container.scrollHeight;
        const input = document.getElementById('question-input');
        const sendBtn = document.getElementById('question-send-btn');
        if (input) input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
    });

    // 6.7 Receive summary result (from UI-triggered or on-demand flow)
    window.uiApi.receiveCommand('main:render-summary', (data) => {
        const summary = data && data.summary != null ? data.summary : '';
        const chatName = (data && data.chatName) || '';
        renderSummaryResult(summary, chatName);
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


// --- Initial Load (Settings-only UI; dashboard/schedules live on the website) ---
document.addEventListener('DOMContentLoaded', () => {
    initializeIPCListeners();
    const mainSetupDiv = document.getElementById('main-setup-div');
    if (mainSetupDiv && window.uiApi) {
        renderDeliverySetup(false);
        window.uiApi.sendData('ui:request-delivery-settings');
    }
});