// --- 1. Module Imports ---
const { app, BrowserWindow, session, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path'); 
const Store = require('electron-store').default;
const Pusher = require('pusher-js');
const twilio = require('twilio');

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
let pusherInstance = null;
let powerSaveBlockerId = null;
const _pendingEditBySender = {};
let _chatListResolve = null;

// --- 2.1. Real-time Command Handling (Pusher Listener) ---
function resolveChatName(partialName, list) {
    if (!partialName) return partialName;
    if (!list || !Array.isArray(list) || list.length === 0) return partialName;
    const p = partialName.trim();
    const exact = list.find((name) => (name || '').trim() === p);
    if (exact) return exact;
    const startsWith = list.find((name) => (name || '').trim().indexOf(p) === 0);
    if (startsWith) return startsWith.trim();
    const includes = list.find((name) => (name || '').includes(p));
    if (includes) return includes.trim();
    return partialName;
}

// Timeout for chat list resolve: getChatList() scrolls through all chats and can take 30–60s for large lists
const CHAT_LIST_RESOLVE_TIMEOUT_MS = 60000;

function getChatListForResolve() {
    return new Promise((resolve) => {
        if (!isWhatsAppWindowAvailable() || !whatsappWindow.webContents) {
            resolve(null);
            return;
        }
        _chatListResolve = resolve;
        // Use separate channel so response is never sent to UI (runs in background)
        whatsappWindow.webContents.send('app:request-chat-list-for-resolve');
        setTimeout(() => {
            if (_chatListResolve) {
                console.log('[Pusher Command] Chat list for resolve: timeout after', CHAT_LIST_RESOLVE_TIMEOUT_MS / 1000, 's');
                _chatListResolve(null);
                _chatListResolve = null;
            }
        }, CHAT_LIST_RESOLVE_TIMEOUT_MS);
    });
}

// Remove unsent scheduled messages whose scheduled time is in the past (no notification).
function prunePastScheduledMessages() {
    const messages = store.get('scheduledMessages') || [];
    const now = new Date();
    const oneMinuteAgo = now.getTime() - 60000;
    let changed = false;
    const updated = messages.filter((m) => {
        if (m.sent || !m.date || !m.time) return true;
        const [y, mo, d] = m.date.split('-').map(Number);
        const [h, min] = m.time.split(':').map(Number);
        const scheduledTime = new Date(y, mo - 1, d, h, min, 0, 0);
        if (scheduledTime.getTime() < oneMinuteAgo) {
            changed = true;
            return false;
        }
        return true;
    });
    if (changed) {
        store.set('scheduledMessages', updated);
        updatePowerSaveBlocker();
        if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', updated.filter(m => !m.sent));
    }
}

function getPendingScheduledMessages() {
    prunePastScheduledMessages();
    return (store.get('scheduledMessages') || []).filter(m => !m.sent);
}

/**
 * Handle incoming WhatsApp command received via Pusher.
 * Routes between Daily Brief and Message Scheduling based on keywords.
 */
async function handleIncomingWhatsAppCommand(message, sender) {
    const text = (message || '').toString().trim();
    if (!text) {
        console.warn('[Pusher Command] Empty message received, ignoring.');
        return;
    }

    console.log('[Pusher Command] Raw command:', { sender, text });

    // "שנה ל X" / "change to X" — change recipient (optional space after ל/to so "שנה לx" and "שנה ל x" both work)
    const changeToMatch = text.match(/^שנה\s+ל\s*(.+)$/) || text.match(/^change\s+to\s*(.+)$/i);
    if (changeToMatch) {
        console.log('[Pusher Command] Detected CHANGE TO (שנה ל) intent');
        if (_pendingEditBySender[sender]) delete _pendingEditBySender[sender];
        await handleChangeRecipient(text, sender);
        return;
    }

    // If sender has pending edit, treat as edit payload unless message is another command
    const pendingEdit = _pendingEditBySender[sender];
    if (pendingEdit) {
        const summaryRegex = /(summary|summarize|סכם|סיכום)/i;
        const scheduleRegex = /(schedule|send at|תזמן|שלח הודעה)/i;
        const listRegex = /(list|רשימה|רשימת הודעות|הודעות מתוזמנות|איזה הודעות מתוזמנות יש לי)/i;
        const cancelLastRegexEdit = /^(בטל|cancel)\s*$/i;
        const deleteRegex = /^(delete|מחק|בטל|cancel)(\s+את)?\s*\d+/i;
        const editRegex = /^(edit|ערוך)(\s+את)?\s*\d+/i;
        if (scheduleRegex.test(text) || summaryRegex.test(text) || isQuestionIntent(text) || listRegex.test(text) || cancelLastRegexEdit.test(text.trim()) || deleteRegex.test(text) || editRegex.test(text)) {
            delete _pendingEditBySender[sender];
        } else {
            handleEditPayload(text, sender);
            return;
        }
    }

    const summaryRegex = /(summary|summarize|סכם|סיכום)/i;
    const scheduleRegex = /(schedule|send at|תזמן|שלח הודעה)/i;
    const listRegex = /(list|רשימה|רשימת הודעות|הודעות מתוזמנות|איזה הודעות מתוזמנות יש לי)/i;
    const cancelLastRegex = /^(בטל|cancel)\s*$/i;
    const deleteMatch = text.match(/^(delete|מחק|בטל|cancel)(\s+את)?\s*(\d+)/i);
    const editMatch = text.match(/^(edit|ערוך)(\s+את)?\s*(\d+)/i);
    const changeMsg = parseChangeMessageCommand(text);

    const isSchedule = scheduleRegex.test(text);
    const isSummary = summaryRegex.test(text);
    const isList = listRegex.test(text);
    const isCancelLast = cancelLastRegex.test(text.trim());
    const isDelete = !isCancelLast && deleteMatch != null;
    const isEdit = editMatch != null && !changeMsg;
    const isChangeSingle = changeMsg != null;

    if (isSchedule) {
        console.log('[Pusher Command] Detected SCHEDULE intent');
        await handleScheduleCommandFromText(text, sender);
    } else if (isSummary) {
        console.log('[Pusher Command] Detected SUMMARY intent');
        await handleSummaryCommandFromText(text, sender);
    } else if (isQuestionIntent(text)) {
        console.log('[Pusher Command] Detected QUESTION intent (fallback)');
        handleQuestionCommandFromText(text, sender);
    } else if (isList) {
        console.log('[Pusher Command] Detected LIST intent');
        handleListScheduledMessages(sender);
    } else if (isCancelLast) {
        console.log('[Pusher Command] Detected CANCEL LAST (בטל) intent');
        handleCancelLastScheduledMessage(sender);
    } else if (isDelete) {
        const n = parseInt(deleteMatch[3], 10);
        console.log('[Pusher Command] Detected DELETE intent, task', n);
        handleDeleteScheduledMessage(n, sender);
    } else if (isChangeSingle) {
        console.log('[Pusher Command] Detected CHANGE (single-shot) intent', changeMsg);
        handleEditSingleField(changeMsg.taskNumber, changeMsg.field, changeMsg.value, sender);
    } else if (isEdit) {
        const n = parseInt(editMatch[3], 10);
        console.log('[Pusher Command] Detected EDIT intent, task', n);
        handleEditScheduledMessage(n, sender);
    } else {
        console.log('[Pusher Command] No matching intent keyword found, ignoring.');
    }
}

// Normalize group/chat name (Hebrew): strip generic "קבוצה"/"קבוצת"/"הקבוצה" prefix when present
function normalizeGroupName(name) {
    if (!name) return null;
    let cleaned = name.trim();
    // E.g. "קבוצת הדירות" -> "הדירות", "הקבוצה חיים קשים" -> "חיים קשים"
    cleaned = cleaned.replace(/^הקבוצה\s+/, '').trim();
    cleaned = cleaned.replace(/^קבוצ[הת]\s+/, '').trim();

    // If phrase contains "עם X" (e.g. "לי את השיחה עם דור"), prefer the part after the last "עם"
    if (cleaned.includes('עם ')) {
        const parts = cleaned.split('עם ').filter(Boolean);
        if (parts.length > 0) {
            cleaned = parts[parts.length - 1].trim();
        }
    }

    return cleaned || name.trim();
}

/**
 * Detect if a text message is a question intent.
 * Checks for question keywords and patterns (Hebrew + English).
 */
function isQuestionIntent(text) {
    if (!text) return false;
    const normalized = text.trim();

    // Question keywords (Hebrew + English)
    const questionKeywords = [
        // Hebrew
        /\b(שאל|תשאל|מה|איך|מתי|איפה|למה|מי)\b/,
        // English
        /\b(ask|question|what|how|when|where|why|who)\b/i
    ];

    // Check for question keywords
    for (const keywordRegex of questionKeywords) {
        if (keywordRegex.test(normalized)) {
            return true;
        }
    }

    // Check for question mark at the end
    if (normalized.endsWith('?') || normalized.endsWith('؟')) {
        return true;
    }

    // Check if message contains a group name (indicates it's about a specific group)
    // This helps distinguish between generic questions and group-specific questions
    const hasGroupName = extractChatNameFromQuestionText(normalized) !== null;
    if (hasGroupName) {
        // If it has a group name and looks like a question, treat it as question intent
        // Look for question patterns even without explicit keywords
        const questionPatterns = [
            /(?:מה|איך|מתי|איפה|למה|מי|what|how|when|where|why|who)/i,
            /\?/,
            /(?:קרה|אמר|כתב|שלח|היה|יש|היו)/ // Common Hebrew verbs in questions
        ];
        for (const pattern of questionPatterns) {
            if (pattern.test(normalized)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Extract chat/group name from a question command.
 * Supports patterns like:
 *  - "שאל את קבוצת הדירות מתי יש פגישה?"
 *  - "מה קרה בקבוצת הדירות היום?"
 *  - "בשיחה עם דור, מתי אמרנו שנפגשים?"
 *  - "ask about MyGroup what happened?"
 */
function extractChatNameFromQuestionText(text) {
    if (!text) return null;
    const normalized = text.trim();

    // Hebrew question patterns
    const hebrewQuestionPatterns = [
        /שאל\s+(?:את|על|ב)\s+(?:קבוצ[הת]\s+)?(.+?)(?:\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/,
        /(?:מה|איך|מתי|איפה|למה|מי)\s+(?:קרה|אמר|כתב|שלח|היה|יש|היו)\s+(?:ב|ב-|בקבוצ[הת]|ב-קבוצ[הת])\s*(.+?)(?:\s+היום|\s+אתמול|\?|$)/,
        /(?:מה|איך|מתי|איפה|למה|מי)\s+(?:קרה|אמר|כתב|שלח|היה|יש|היו)\s+(?:עם|ל)\s+(.+?)(?:\s+היום|\s+אתמול|\?|$)/,
        // Add pattern for "בשיחה עם" (conversation with) - stop at verbs or question words
        // Match up to 2 words (for names like "רתם אנין") then stop at common verbs
        /בשיחה\s+עם\s+([^\s]+(?:\s+[^\s]+)?)(?:\s+(?:דיברו|אמרו|כתבו|שלחו|היה|היו|קרה|קרהו|נאמר|נכתב|נשלח|נדבר|דיבר|אמר|כתב|שלח|קרה|נדבר|נאמר|נכתב|נשלח)|,|\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/,
        // Add pattern for "בקבוצת" (in group) - stop at verbs or question words
        /בקבוצ[הת]\s+([^\s]+(?:\s+[^\s]+)?)(?:\s+(?:דיברו|אמרו|כתבו|שלחו|היה|היו|קרה|קרהו|נאמר|נכתב|נשלח|נדבר|דיבר|אמר|כתב|שלח|קרה|נדבר|נאמר|נכתב|נשלח)|,|\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/,
        // Add pattern for "עם" at start or after comma - stop at verbs
        /(?:^|,)\s*עם\s+([^\s]+(?:\s+[^\s]+)?)(?:\s+(?:דיברו|אמרו|כתבו|שלחו|היה|היו|קרה|קרהו|נאמר|נכתב|נשלח|נדבר|דיבר|אמר|כתב|שלח|קרה|נדבר|נאמר|נכתב|נשלח)|,|\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/,
        // Add pattern for "ל" (to/for) at start or after comma - stop at verbs
        /(?:^|,)\s*ל\s+([^\s]+(?:\s+[^\s]+)?)(?:\s+(?:דיברו|אמרו|כתבו|שלחו|היה|היו|קרה|קרהו|נאמר|נכתב|נשלח|נדבר|דיבר|אמר|כתב|שלח|קרה|נדבר|נאמר|נכתב|נשלח)|,|\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/,
        // Generic fallback: look for common prefixes - stop at verbs
        /(?:בקבוצ[הת]|קבוצ[הת]|עם|ל)\s+([^\s]+(?:\s+[^\s]+)?)(?:\s+(?:דיברו|אמרו|כתבו|שלחו|היה|היו|קרה|קרהו|נאמר|נכתב|נשלח|נדבר|דיבר|אמר|כתב|שלח|קרה|נדבר|נאמר|נכתב|נשלח)|,|\s+מה|\s+איך|\s+מתי|\s+איפה|\s+למה|\s+מי|\s+היום|\s+אתמול|\?|$)/
    ];

    for (const pattern of hebrewQuestionPatterns) {
        const m = normalized.match(pattern);
        if (m && m[1]) {
            const extracted = normalizeGroupName(m[1].trim());
            if (extracted && extracted.length > 0) {
                return extracted;
            }
        }
    }

    // English question patterns
    const englishQuestionPatterns = [
        /(?:ask|question)\s+(?:about|for|in)\s+(.+?)(?:\s+what|\s+how|\s+when|\s+where|\s+why|\s+who|\?|$)/i,
        /(?:what|how|when|where|why|who)\s+(?:happened|said|wrote|sent|was|is|are)\s+(?:in|about|with|to)\s+(.+?)(?:\?|$)/i,
        // Add pattern for "with" or "to" at start or after comma
        /(?:^|,)\s*(?:with|to|about|in)\s+(.+?)(?:\s*,|\s+what|\s+how|\s+when|\s+where|\s+why|\s+who|\?|$)/i,
        /(?:in|about|with|to)\s+(.+?)(?:\s+what|\s+how|\s+when|\s+where|\s+why|\s+who|\?|$)/i
    ];

    for (const pattern of englishQuestionPatterns) {
        const m = normalized.match(pattern);
        if (m && m[1]) {
            const extracted = normalizeGroupName(m[1].trim());
            if (extracted && extracted.length > 0) {
                return extracted;
            }
        }
    }

    // Fallback: try generic extraction (reuse existing function)
    return extractChatNameFromText(normalized);
}

/**
 * Extract the question text from a command, removing group name and question keywords.
 */
function extractQuestionFromText(text, chatName) {
    if (!text) return '';
    let question = text.trim();

    // Remove common question prefixes (Hebrew)
    question = question.replace(/^(?:שאל|תשאל)\s+(?:את|על|ב)\s+(?:קבוצ[הת]\s+)?[^\s]+\s*/i, '');
    
    // Remove "בשיחה עם" pattern - keep the verb in the question
    // Match "בשיחה עם" + chat name (1-2 words) - but don't remove the verb that follows
    if (chatName) {
        const chatNameEscaped = chatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Pattern: "בשיחה עם" + chat name + optional comma/space (but keep verb)
        question = question.replace(
            new RegExp(`^בשיחה\\s+עם\\s+${chatNameEscaped}\\s*,?\\s*`, 'gi'),
            ''
        );
    } else {
        // Fallback: remove "בשיחה עם" + up to 2 words (but keep verb)
        question = question.replace(/^בשיחה\s+עם\s+[^\s]+(?:\s+[^\s]+)?\s*,?\s*/i, '');
    }
    
    // Remove common question prefixes (English)
    question = question.replace(/^(?:ask|question)\s+(?:about|for|in)\s+[^\s]+\s*/i, '');

    // Remove group name if present (with various prefixes)
    if (chatName) {
        const chatNameEscaped = chatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`(?:בקבוצ[הת]|קבוצ[הת]|עם|ל)\\s*${chatNameEscaped}\\s*,?\\s*`, 'gi'),
            new RegExp(`(?:in|about|with|to)\\s*${chatNameEscaped}\\s*,?\\s*`, 'gi'),
            new RegExp(chatNameEscaped, 'gi')
        ];
        for (const pattern of patterns) {
            question = question.replace(pattern, '');
        }
    }

    // Clean up whitespace and leading commas
    question = question.replace(/^[,.\s]+/, '').trim();

    // If question is empty or too short, use the original text
    if (!question || question.length < 3) {
        question = text.trim();
    }

    return question;
}

/**
 * Handle a question command: extract messages from the specified group and answer the question.
 */
function handleQuestionCommandFromText(text, sender) {
    const chatName = extractChatNameFromQuestionText(text);
    if (!chatName) {
        console.warn('[Pusher Command] Question intent detected but no chat/group name found in text:', text);
        return;
    }

    const question = extractQuestionFromText(text, chatName);
    if (!question) {
        console.warn('[Pusher Command] Question intent detected but no question text found:', text);
        return;
    }

    console.log(`[Pusher Command] Processing question for chat: "${chatName}", question: "${question}" (sender: ${sender || 'unknown'})`);

    // Process question asynchronously
    processQuestionForChat(chatName, question, sender).catch(err => {
        console.error('[Pusher Command] Error while processing question for chat', chatName, err);
    });
}

/**
 * Try to extract a chat / group name from free-text command.
 * Uses a robust approach that identifies where the group name starts
 * based on structural patterns, then extracts it.
 * Supports patterns like:
 *  - "summary for MyGroup"
 *  - "סכם את קבוצת הדירות"
 *  - "סכם את השיחה בMeDS"
 *  - "סכם מה דיברו בקבוצה של MeDS"
 *  - "סיכום של קבוצת משפחה"
 */
function extractChatNameFromText(text) {
    if (!text) return null;

    const normalized = text.trim();

    // Patterns that indicate where the group name starts (ordered by specificity)
    // These patterns capture the group name that comes AFTER the marker
    const groupNameMarkers = [
        // "שלח סיכום של דני שובבני" -> extract "דני שובבני" (full name)
        /(?:שלח\s+)?סיכום\s+של\s+(.+?)(?:\s*$|\?|,)/,
        // "סכם מה דיברו בקבוצה של X" -> extract "X"
        /(?:סכם|סיכום)\s+מה\s+דיברו\s+ב(?:קבוצ[הת]|קהילה)\s+של\s+(.+?)(?:\s|$|\?|,)/,
        // "סכם מה דיברו בX" -> extract "X"
        /(?:סכם|סיכום)\s+מה\s+דיברו\s+ב\s*(.+?)(?:\s|$|\?|,)/,
        // "סכם את השיחה עם X" -> extract "X" (must come before "ב" pattern)
        /(?:סכם|סיכום)\s+את\s+השיחה\s+עם\s+(.+?)(?:\s|$|\?|,)/,
        // "סכם את השיחה בX" or "סכם את השיחה בקבוצה X" -> extract "X"
        /(?:סכם|סיכום)\s+את\s+השיחה\s+ב(?:קבוצ[הת]|קהילה)?\s*(.+?)(?:\s|$|\?|,)/,
        // "מה היה היום בX" or "מה היה היום בקבוצה X" -> extract "X"
        /מה\s+היה\s+היום\s+ב(?:קבוצ[הת]|קהילה)?\s*(.+?)(?:\s|$|\?|,)/,
        // "סכם את קבוצת X" -> extract "X"
        /(?:סכם|סיכום)\s+את\s+קבוצ[הת]\s+(.+?)(?:\s|$|\?|,)/,
        // "סיכום קבוצת X" -> extract "X"
        /סיכום\s+קבוצ[הת]\s+(.+?)(?:\s|$|\?|,)/,
        // "סכם את X" -> extract "X" (but be careful - might capture too much)
        /(?:סכם|סיכום)(?:\s+את|\s+על|\s+ל)?\s+(.+?)(?:\s+ב|\s+בשעה|\s+מחר|\s+היום|$|\?|,)/,
        // English: "summary for X" or "summarize for X"
        /(?:summary|summarize)\s+for\s+(.+?)(?:\s+at\b|\s+on\b|$)/i,
        // English: "summary X" or "summarize X"
        /(?:summary|summarize)\s+(.+?)(?:\s+at\b|\s+on\b|$)/i
    ];

    // Try each pattern in order
    for (const pattern of groupNameMarkers) {
        const match = normalized.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].trim();
            // Remove trailing punctuation
            const cleaned = extracted.replace(/[?.,!;:]+$/, '').trim();
            if (cleaned && cleaned.length > 0) {
                // Return full name (e.g. "דני שובבני") so multi-word chat names are preserved
                return normalizeGroupName(cleaned);
            }
        }
    }

    // Fallback: Try to find group name after common prepositions
    const fallbackPatterns = [
        /\bfor\s+(.+?)(?:\s+at\b|\s+on\b|$)/i,
        /\bto\s+(.+?)(?:\s+at\b|\s+on\b|$)/i,
        /עם\s+(.+?)(?:\s+ב|\s+בשעה|$)/,
        /לקבוצה\s+(.+?)(?:\s+ב|\s+בשעה|$)/
    ];

    for (const pattern of fallbackPatterns) {
        const match = normalized.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].trim().replace(/[?.,!;:]+$/, '').trim();
            if (extracted && extracted.length > 0) {
                const parts = extracted.split(/\s+/);
                return normalizeGroupName(parts[0]);
            }
        }
    }

    return null;
}

/**
 * Handle a "summary" style command: trigger an immediate Daily Brief
 * for the requested chat/group.
 */
async function handleSummaryCommandFromText(text, sender) {
    let chatName = extractChatNameFromText(text);
    if (!chatName) {
        console.warn('[Pusher Command] Summary intent detected but no chat/group name found in text:', text);
        return;
    }

    // Resolve to actual chat name (e.g. with emoji) so summary title shows correct name
    const list = await getChatListForResolve();
    const resolvedName = resolveChatName(chatName, list);
    if (resolvedName) chatName = resolvedName;

    console.log(`[Pusher Command] Triggering Daily Brief for chat: "${chatName}" (sender: ${sender || 'unknown'})`);

    const onDemandChat = {
        name: chatName,
        time: '00:00',
        frequency: 'on-demand',
        lastRunTime: null,
        _onDemandSender: sender
    };

    processChatQueue([onDemandChat]).catch(err => {
        console.error('[Pusher Command] Error while running Daily Brief for chat', chatName, err);
    });
}

/**
 * Parse a scheduling command and create a scheduled message entry.
 * Expected patterns (flexible, best-effort):
 *  - "schedule for MyGroup at 21:30 Hello team..."
 *  - "send at 09:00 to MyGroup Good morning"
 *  - "תזמן שלח הודעה לקבוצה משפחה ב 21:30 טקסט כלשהו"
 */
function extractChatNameFromScheduleText(text) {
    if (!text) return null;
    const normalized = text.trim();

    // "שלח הודעה לקבוצה x בשעה y ותכתוב z" -> chat name is x (strip "לקבוצה ")
    const toGroupMatch = normalized.match(/שלח\s+הודעה\s+לקבוצה\s+(.+?)(?:\s+בשעה|\s+ב\s*\d|\s+מחר|\s+היום|\s+מחרתיים|\s*,|$)/);
    if (toGroupMatch && toGroupMatch[1]) {
        return normalizeGroupName(toGroupMatch[1].trim());
    }

    // Hebrew schedule-style: "שלח הודעה ל<name> ..." / "תזמן ... ל<name> ..."
    const patterns = [
        /שלח\s+הודעה\s+ל(.+?)(?:\s+מחר|\s+היום|\s+מחרתיים|\s+בשעה|\s+ב\s*\d|\s*,|$)/,
        /תזמן(?:\s+הודעה)?\s+ל(.+?)(?:\s+מחר|\s+היום|\s+מחרתיים|\s+בשעה|\s+ב\s*\d|\s*,|$)/
    ];

    for (const pattern of patterns) {
        const m = normalized.match(pattern);
        if (m && m[1]) {
            return normalizeGroupName(m[1]);
        }
    }

    // Generic Hebrew "ל<name>" near time/date words (fallback)
    const genericMatch = normalized.match(/ל([^,]+?)(?:\s+מחר|\s+היום|\s+מחרתיים|\s+בשעה|\s+ב\s*\d|\s*,|$)/);
    if (genericMatch && genericMatch[1]) {
        return normalizeGroupName(genericMatch[1]);
    }

    return null;
}

// Split free-text into "header" (recipient/time) and "content" (message body)
// using a set of Hebrew/structural keywords (e.g. "תכתוב", "עם הטקסט", "ותגיד לו", "תוכן", ":").
function splitMessageContentFromText(text) {
    if (!text) return { header: '', content: '' };
    const normalized = text.trim();

    const contentKeywords = [
        'תכתוב',
        'שאומרת',
        'שאמרת',
        'עם הטקסט',
        'ותגיד לו',
        'ותגיד לה',
        'ותגידי לו',
        'ותגידי לה',
        'תוכן'
    ];

    let bestIndex = -1;
    let bestLength = 0;

    // Look for explicit Hebrew content keywords
    for (const kw of contentKeywords) {
        const idx = normalized.indexOf(kw);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
            bestLength = kw.length;
        }
    }

    // Also treat ":" as a possible separator, but ONLY if it's not part of a time (e.g. 10:30)
    let colonIdx = -1;
    for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === ':') {
            const before = normalized.slice(Math.max(0, i - 2), i).trim(); // up to 2 digits before
            const after = normalized.slice(i + 1, i + 3);                  // up to 2 digits after
            const isTimeColon =
                /^\d{1,2}$/.test(before) && /^\d{2}$/.test(after);
            if (!isTimeColon) {
                colonIdx = i;
                break;
            }
        }
    }
    if (colonIdx !== -1 && (bestIndex === -1 || colonIdx < bestIndex)) {
        bestIndex = colonIdx;
        bestLength = 1;
    }

    if (bestIndex === -1) {
        return { header: normalized, content: '' };
    }

    const header = normalized.slice(0, bestIndex).trim();
    let content = normalized.slice(bestIndex + bestLength);
    // Strip leading punctuation/whitespace
    content = content.replace(/^[\s,:-]+/, '').trim();

    return { header, content };
}

function parseScheduleCommandFromText(text) {
    if (!text) return null;

    const fullText = text.trim();

    // 1) Split into header (recipient/time) and content (message body)
    const { header, content } = splitMessageContentFromText(fullText);

    // 2) Extract time: prefer HH:MM (so "31.1" / "1.2" are not mistaken for hour)
    let time = null;
    const timeColonMatch = fullText.match(/(\d{1,2}):(\d{2})/);
    if (timeColonMatch) {
        const h = parseInt(timeColonMatch[1], 10);
        const m = parseInt(timeColonMatch[2], 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        }
    }
    if (!time) {
        // Bare hour only if not part of date (e.g. not "31" from "31.1" or "1" from "1.2") — \b(\d{1,2})\b(?!\.)
        const bareHourMatch = fullText.match(/\b(\d{1,2})\b(?!\.)/);
        if (bareHourMatch) {
            const hour = parseInt(bareHourMatch[1], 10);
            if (hour >= 0 && hour <= 23) {
                time = String(hour).padStart(2, '0') + ':00';
            }
        }
    }
    if (!time) {
        console.warn('[Pusher Command] Schedule intent detected but no valid time (HH:MM or hour 0-23) found in text:', text);
        return null;
    }

    // 3) Date: YYYY-MM-DD or Hebrew short form d.m / d.m. (day.month)
    const dateMatch = fullText.match(/(\d{4}-\d{2}-\d{2})/);
    const dmMatch = !dateMatch ? fullText.match(/(?:ב)?(\d{1,2})\.(\d{1,2})\.?/) : null;

    let date;
    const now = new Date();
    if (dateMatch) {
        date = dateMatch[1];
    } else if (dmMatch) {
        const day = parseInt(dmMatch[1], 10);
        const month = parseInt(dmMatch[2], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const year = now.getFullYear();
            let dateObj = new Date(year, month - 1, day);
            if (dateObj < new Date(year, now.getMonth(), now.getDate())) {
                dateObj = new Date(year + 1, month - 1, day);
            }
            date = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        }
    }
    if (!date) {
        const [h, m] = time.split(':').map(Number);
        const scheduled = new Date(now);
        scheduled.setHours(h, m, 0, 0);
        if (scheduled <= now) {
            scheduled.setDate(scheduled.getDate() + 1);
        }
        date = `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(scheduled.getDate()).padStart(2, '0')}`;
    }

    // 4) Extract chat/group name from the header (preferred) or full text
    const baseTextForRecipient = header || fullText;
    const chatName =
        extractChatNameFromScheduleText(baseTextForRecipient) ||
        extractChatNameFromText(baseTextForRecipient);
    if (!chatName) {
        console.warn('[Pusher Command] Schedule intent detected but no chat/group name found in text:', text);
        return null;
    }

    // 5) Determine message body
    let messageText = content;

    // Fallback: if no explicit content keyword was found, derive content
    // by stripping known structural words, chat name, date and time.
    if (!messageText) {
        messageText = fullText;
        // Remove English keywords
        messageText = messageText.replace(/schedule|send at|send|at|for|to/gi, ' ');
        // Remove Hebrew structural words
        messageText = messageText.replace(/תזמן|שלח הודעה|לקבוצה|עם|למחר|היום|מחרתיים|מחר|בשעה|ביום/gi, ' ');
        // Remove chat name, date and time
        messageText = messageText.replace(chatName, ' ');
        if (dateMatch) {
            messageText = messageText.replace(dateMatch[1], ' ');
        } else if (dmMatch) {
            messageText = messageText.replace(dmMatch[0], ' ');
        }
        messageText = messageText.replace(time, ' ');
        // Collapse whitespace
        messageText = messageText.replace(/\s+/g, ' ').trim();
    }

    if (!messageText) {
        messageText = `Scheduled message from WhatsApp command for "${chatName}"`;
    }

    return {
        chatName: chatName.trim(),
        date,
        time,
        message: messageText
    };
}

/**
 * Handle a "schedule/send at" style command:
 * create a new scheduled message using the existing scheduling feature.
 * Resolves chat name against WhatsApp chat list so confirmation shows actual contact name.
 */
async function handleScheduleCommandFromText(text, sender) {
    const parsed = parseScheduleCommandFromText(text);
    if (!parsed) return;

    let { chatName, date, time, message } = parsed;
    const partialName = (parsed.chatName || '').trim();
    // Resolve to full name from chat list (background; same getChatList() as UI, never sent to UI)
    const list = await getChatListForResolve();
    console.log('[Pusher Command] Chat list for resolve: list is', list ? `array of ${list.length} items` : 'null');
    if (list && list.length > 0) {
        const sample = list.slice(0, 5).map((n, i) => `"${(n || '').trim()}"`).join(', ');
        console.log('[Pusher Command] Chat list sample (first 5):', sample);
    }
    const resolvedName = resolveChatName(chatName, list);
    console.log('[Pusher Command] Resolve: partialName="' + partialName + '" -> resolvedName="' + (resolvedName || '') + '"');
    const fullChatName = (resolvedName && resolvedName.trim()) ? resolvedName.trim() : chatName;
    console.log('[Pusher Command] fullChatName used for confirmation and store:', JSON.stringify(fullChatName));
    if (resolvedName) chatName = resolvedName;
    const multipleMatches = !!(list && partialName && list.filter((n) => (n || '').trim().includes(partialName)).length > 1);

    // Reject if scheduled time is in the past
    const [y, mo, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    const scheduledTime = new Date(y, mo - 1, d, h, min, 0, 0);
    const now = new Date();
    if (scheduledTime.getTime() < now.getTime() - 60000) {
        console.log(`[Pusher Command] Rejected: scheduled time ${date} ${time} is in the past`);
        if (sender) {
            const isHebrew = /[\u0590-\u05FF]/.test(text);
            const msg = isHebrew
                ? `הזמן שבחרת (${date} ${time}) כבר עבר. בחר תאריך ושעה בעתיד.`
                : `The time you chose (${date} ${time}) is in the past. Please choose a future date and time.`;
            callSendNotification(sender, msg).catch(() => {});
        }
        return;
    }

    console.log(`[Pusher Command] Scheduling message for chat "${fullChatName}" at ${date} ${time} (sender: ${sender || 'unknown'})`);
    console.log('[Pusher Command] Scheduled message text:', message);

    const existing = store.get('scheduledMessages') || [];
    const updated = [
        ...existing,
        {
            chatName: fullChatName,
            message,
            date,
            time,
            sent: false,
            sender: sender || null,
            hadMultipleMatches: multipleMatches || false
        }
    ];
    store.set('scheduledMessages', updated);
    updatePowerSaveBlocker();

    if (sender) {
        const isHebrew = /[\u0590-\u05FF]/.test(text);
        // Use full chat name from list in confirmation (same names as schedule message UI)
        let confirmationMessage = isHebrew
            ? `תזמנתי לך הודעה ל${fullChatName} בתאריך ${date} בשעה ${time}.\nתוכן ההודעה: '${message}'. השב 'בטל' לביטול.`
            : `I've scheduled your message to ${fullChatName} on date ${date} at time ${time}.\nMessage content: '${message}'. Reply 'cancel' to cancel.`;
        if (multipleMatches) {
            confirmationMessage += isHebrew
                ? `\n(יש יותר מאיש קשר אחד עם שם דומה; תזמנתי ל${fullChatName}. השב 'שנה ל [השם של איש הקשר הנכון]' או 'בטל' לביטול.)`
                : `\n(More than one contact matches; scheduled to ${fullChatName}. Reply 'change to [correct contact name]' or 'cancel' to cancel.)`;
        }
        console.log('[Pusher Command] Sending confirmation to sender; fullChatName in message:', JSON.stringify(fullChatName));
        callSendNotification(sender, confirmationMessage).catch(() => {});
    }

    if (!automationInterval) startAutomationLoop();

    if (isUIWindowAvailable()) {
        try {
            uiWindow.webContents.send(
                'main:render-scheduled-messages',
                updated.filter(msg => !msg.sent)
            );
            uiWindow.webContents.send('main:automation-status', {
                message: `Scheduled message for "${fullChatName}" at ${date} ${time} (via WhatsApp command)`
            });
        } catch (err) {
            console.error('[Pusher Command] Error sending UI update for scheduled messages:', err);
        }
    }
}

/** Handle "שנה ל X" / "change to X": update recipient (X = chatName). Optional space after ל/to. */
async function handleChangeRecipient(text, sender) {
    const m = text.match(/^שנה\s+ל\s*(.+)$/) || text.match(/^change\s+to\s*(.+)$/i);
    if (!m || !sender) return;
    const newContactPartial = m[1].trim();
    if (!newContactPartial) return;

    const list = await getChatListForResolve();
    const fullName = resolveChatName(newContactPartial, list) || newContactPartial;

    const messages = store.get('scheduledMessages') || [];
    let storeIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].sent && messages[i].sender === sender && messages[i].hadMultipleMatches) {
            storeIndex = i;
            break;
        }
    }
    if (storeIndex < 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (!messages[i].sent && messages[i].sender === sender) {
                storeIndex = i;
                break;
            }
        }
    }
    if (storeIndex < 0) {
        const isHebrew = /[\u0590-\u05FF]/.test(text);
        const msg = isHebrew ? 'אין הודעה מתוזמנת אחרונה שלך — לא ניתן לשנות נמען.' : 'No recent scheduled message from you to change recipient.';
        callSendNotification(sender, msg).catch(() => {});
        return;
    }

    const task = messages[storeIndex];
    task.chatName = fullName;
    task.hadMultipleMatches = false;
    store.set('scheduledMessages', messages);
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(m => !m.sent));

    const isHebrew = /[\u0590-\u05FF]/.test(text);
    const confirmationMessage = isHebrew
        ? `עדכנתי את הנמען ל${fullName}. תזמנתי לך הודעה ל${fullName} בתאריך ${task.date} בשעה ${task.time}.\nתוכן ההודעה: '${task.message || ''}'. השב 'בטל' לביטול.`
        : `Updated recipient to ${fullName}. I've scheduled your message to ${fullName} on date ${task.date} at time ${task.time}.\nMessage content: '${task.message || ''}'. Reply 'cancel' to cancel.`;
    callSendNotification(sender, confirmationMessage).catch(() => {});
}

function handleListScheduledMessages(sender) {
    const pending = getPendingScheduledMessages();
    const isHebrew = /[\u0590-\u05FF]/.test(pending.length ? (pending[0].chatName || '') : '');
    if (pending.length === 0) {
        const msg = isHebrew ? 'אין הודעות מתוזמנות.' : 'No scheduled messages.';
        callSendNotification(sender, msg).catch(() => {});
        return;
    }
    const sep = isHebrew ? ' ב' : ' at ';
    const lines = pending.map((m, i) => {
        const timeStr = `${m.date} ${m.time}`;
        const preview = (m.message || '').length > 40 ? (m.message || '').substring(0, 37) + '...' : (m.message || '');
        return `${i + 1}. ${m.chatName}${sep}${timeStr} — ${preview}`;
    });
    callSendNotification(sender, lines.join('\n')).catch(() => {});
}

function handleCancelLastScheduledMessage(sender) {
    const messages = store.get('scheduledMessages') || [];
    let storeIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].sent && messages[i].sender === sender) {
            storeIndex = i;
            break;
        }
    }
    if (storeIndex < 0) {
        const isHebrew = /[\u0590-\u05FF]/.test(sender || '');
        const msg = isHebrew ? 'אין הודעה מתוזמנת אחרונה שלך לביטול.' : 'No scheduled message from you to cancel.';
        callSendNotification(sender, msg).catch(() => {});
        return;
    }
    const removed = messages.splice(storeIndex, 1)[0];
    store.set('scheduledMessages', messages);
    updatePowerSaveBlocker();
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(m => !m.sent));
    const isHebrew = /[\u0590-\u05FF]/.test(removed.chatName || '');
    const confirm = isHebrew ? `ביטלתי את ההודעה המתוזמנת ל${removed.chatName}.` : `Cancelled the scheduled message to ${removed.chatName}.`;
    callSendNotification(sender, confirm).catch(() => {});
}

function handleDeleteScheduledMessage(taskNumber, sender) {
    const pending = getPendingScheduledMessages();
    const index = taskNumber - 1;
    if (index < 0 || index >= pending.length) {
        const isHebrew = /[\u0590-\u05FF]/.test((pending[0] && pending[0].chatName) || '');
        const msg = isHebrew ? `אין הודעה ${taskNumber}. שלח 'רשימת הודעות' לקבלת הרשימה המלאה.` : `No message ${taskNumber}. Send 'list' for the full list.`;
        callSendNotification(sender, msg).catch(() => {});
        return;
    }
    const messages = store.get('scheduledMessages') || [];
    const pendingIndices = messages.map((m, i) => (!m.sent ? i : -1)).filter(i => i >= 0);
    const storeIndex = pendingIndices[index];
    messages.splice(storeIndex, 1);
    store.set('scheduledMessages', messages);
    updatePowerSaveBlocker();
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(m => !m.sent));
    const isHebrew = /[\u0590-\u05FF]/.test((pending[index] && pending[index].chatName) || '');
    const confirm = isHebrew ? `הודעה ${taskNumber} נמחקה.` : `Message ${taskNumber} deleted.`;
    callSendNotification(sender, confirm).catch(() => {});
}

// Parse single-shot "שנה את X של הודעה N ל Y" / "change X of message N to Y"
function parseChangeMessageCommand(text) {
    const t = text.trim();
    const hebrewNum = { אחד: 1, שתיים: 2, שלוש: 3, ארבע: 4, חמש: 5 };
    const m = t.match(/שנה\s+את\s+(השעה|התוכן|השם|הנמען|התאריך)\s+של\s+הודעה\s+(1|2|3|4|5|\d+|אחד|שתיים|שלוש|ארבע|חמש)\s+ל\s*(.+)/i) ||
        t.match(/change\s+(time|content|name|recipient|date)\s+of\s+message\s+(1|2|3|4|5|\d+)\s+to\s*(.+)/i);
    if (!m) return null;
    const fieldMap = { 'השעה': 'time', 'התוכן': 'message', 'השם': 'chatName', 'הנמען': 'chatName', 'התאריך': 'date', 'time': 'time', 'content': 'message', 'name': 'chatName', 'recipient': 'chatName', 'date': 'date' };
    const field = fieldMap[m[1]];
    if (!field) return null;
    let taskNum = parseInt(m[2], 10);
    if (isNaN(taskNum)) taskNum = hebrewNum[m[2]] || null;
    if (taskNum == null || taskNum < 1) return null;
    const value = m[3].trim();
    if (!value) return null;
    return { taskNumber: taskNum, field, value };
}

function handleEditSingleField(taskNumber, field, value, sender) {
    const pending = getPendingScheduledMessages();
    const index = taskNumber - 1;
    if (index < 0 || index >= pending.length) {
        const isHebrew = /[\u0590-\u05FF]/.test(value || '');
        const msg = isHebrew ? `אין הודעה ${taskNumber}. שלח 'רשימת הודעות' לקבלת הרשימה המלאה.` : `No message ${taskNumber}. Send 'list' for the full list.`;
        callSendNotification(sender, msg).catch(() => {});
        return;
    }
    const messages = store.get('scheduledMessages') || [];
    const pendingIndices = messages.map((m, i) => (!m.sent ? i : -1)).filter(i => i >= 0);
    const storeIndex = pendingIndices[index];
    const task = messages[storeIndex];
    const updates = {};
    if (field === 'chatName') updates.chatName = value;
    else if (field === 'time') {
        let time = value;
        if (!/^\d{1,2}:\d{2}$/.test(time)) {
            const hour = parseInt(value.replace(/\D/g, ''), 10);
            if (!isNaN(hour) && hour >= 0 && hour <= 23) time = String(hour).padStart(2, '0') + ':00';
        }
        if (time) updates.time = time;
    } else if (field === 'date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) updates.date = value;
        else {
            const now = new Date();
            const lower = value.toLowerCase();
            if (lower.includes('מחר') || lower.includes('tomorrow')) {
                const d = new Date(now);
                d.setDate(d.getDate() + 1);
                updates.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } else if (lower.includes('היום') || lower.includes('today')) {
                updates.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }
        }
    } else if (field === 'message') updates.message = value;
    if (Object.keys(updates).length === 0) {
        callSendNotification(sender, 'לא הצלחתי לפרש את הערך.').catch(() => {});
        return;
    }
    Object.assign(task, updates);
    store.set('scheduledMessages', messages);
    updatePowerSaveBlocker();
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(m => !m.sent));
    const isHebrew = /[\u0590-\u05FF]/.test(task.chatName || '');
    const confirm = isHebrew ? `הודעה ${taskNumber} עודכנה.` : `Message ${taskNumber} updated.`;
    callSendNotification(sender, confirm).catch(() => {});
}

function handleEditScheduledMessage(taskNumber, sender) {
    const pending = getPendingScheduledMessages();
    const index = taskNumber - 1;
    if (index < 0 || index >= pending.length) {
        const isHebrew = /[\u0590-\u05FF]/.test((pending[0] && pending[0].chatName) || '');
        const msg = isHebrew ? `אין הודעה ${taskNumber}. שלח 'רשימת הודעות' לקבלת הרשימה המלאה.` : `No message ${taskNumber}. Send 'list' for the full list.`;
        callSendNotification(sender, msg).catch(() => {});
        return;
    }
    const messages = store.get('scheduledMessages') || [];
    const pendingIndices = messages.map((m, i) => (!m.sent ? i : -1)).filter(i => i >= 0);
    const storeIndex = pendingIndices[index];
    const task = messages[storeIndex];
    const isHebrew = /[\u0590-\u05FF]/.test(task.chatName || '');
    const current = isHebrew
        ? `${taskNumber}. ${task.chatName} ב${task.date} ${task.time} — ${(task.message || '').substring(0, 50)}${(task.message || '').length > 50 ? '...' : ''}. השב עם הערכים החדשים (שם, תאריך, שעה, תוכן ההודעה). אפשר לשנות פרמטר אחד או יותר.`
        : `${taskNumber}. ${task.chatName} at ${task.date} ${task.time} — ${(task.message || '').substring(0, 50)}${(task.message || '').length > 50 ? '...' : ''}. Reply with new values (name, date, time, message content). You can change one or more parameters.`;
    _pendingEditBySender[sender] = { storeIndex, taskNumber };
    callSendNotification(sender, current).catch(() => {});
}

function parseEditPayload(text) {
    const out = {};
    const t = text.trim();
    if (!t) return out;
    const nameMatch = t.match(/(?:name|שם|לשם)\s*[:\s]?\s*([^\n,]+)/i);
    if (nameMatch) out.chatName = nameMatch[1].trim();
    const dateMatch = t.match(/(\d{4}-\d{2}-\d{2})/) || t.match(/(?:date|תאריך)\s*[:\s]?\s*([^\n,]+)/i);
    if (dateMatch) {
        const raw = dateMatch[1].trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            out.date = raw;
        } else {
            const now = new Date();
            const lower = raw.toLowerCase();
            if (lower.includes('מחר') || lower.includes('tomorrow')) {
                const d = new Date(now);
                d.setDate(d.getDate() + 1);
                out.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } else if (lower.includes('היום') || lower.includes('today')) {
                out.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }
        }
    }
    const timeMatch = t.match(/(?:time|שעה|בשעה)\s*[:\s]?\s*(\d{1,2}(?::\d{2})?|\d{1,2})/i) || t.match(/(\d{1,2}:\d{2}|\d{1,2})(?=\s|$|,)/);
    if (timeMatch) {
        let time = timeMatch[1].trim();
        if (!time.includes(':')) {
            const hour = parseInt(time, 10);
            if (!isNaN(hour) && hour >= 0 && hour <= 23) time = String(hour).padStart(2, '0') + ':00';
            else time = null;
        }
        if (time) out.time = time;
    }
    const contentMatch = t.match(/(?:content|תוכן ההודעה|תוכן|message)\s*[:\s]?\s*([\s\S]+)/i);
    if (contentMatch) out.message = contentMatch[1].trim();
    return out;
}

function handleEditPayload(text, sender) {
    const pending = _pendingEditBySender[sender];
    if (!pending) return;
    const messages = store.get('scheduledMessages') || [];
    if (pending.storeIndex < 0 || pending.storeIndex >= messages.length) {
        delete _pendingEditBySender[sender];
        return;
    }
    const updates = parseEditPayload(text);
    const task = messages[pending.storeIndex];
    if (updates.chatName !== undefined) task.chatName = updates.chatName;
    if (updates.date !== undefined) task.date = updates.date;
    if (updates.time !== undefined) task.time = updates.time;
    if (updates.message !== undefined) task.message = updates.message;
    store.set('scheduledMessages', messages);
    delete _pendingEditBySender[sender];
    updatePowerSaveBlocker();
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', messages.filter(m => !m.sent));
    const isHebrew = /[\u0590-\u05FF]/.test(task.chatName || '');
    const confirm = isHebrew ? `הודעה ${pending.taskNumber} עודכנה.` : `Message ${pending.taskNumber} updated.`;
    callSendNotification(sender, confirm).catch(() => {});
}

/**
 * Set up Pusher listener for real-time WhatsApp commands.
 * Starts once the app is ready.
 */
function setupPusherListener() {
    try {
        // Use hardcoded Pusher credentials
        const PUSHER_KEY = '9074ed07371db1b3c01d';
        const PUSHER_CLUSTER = 'eu';

        console.log('[Pusher] Initializing Pusher client...');

        pusherInstance = new Pusher(PUSHER_KEY, {
            cluster: PUSHER_CLUSTER,
            forceTLS: true
        });

        const channel = pusherInstance.subscribe('whatsapp-channel');

        channel.bind('new-command', async (data) => {
            console.log('[Pusher] New command received via WhatsApp:', data);
            try {
                await handleIncomingWhatsAppCommand(data.message, data.sender);
            } catch (err) {
                console.error('[Pusher] Error handling incoming WhatsApp command:', err);
            }
        });

        console.log('[Pusher] Listening on channel "whatsapp-channel", event "new-command".');
    } catch (error) {
        console.error('[Pusher] Failed to initialize Pusher listener:', error);
    }
}

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

// --- 2.2. Power Save Blocker (anti-sleep when pending scheduled messages) ---
function updatePowerSaveBlocker() {
    const pending = (store.get('scheduledMessages') || []).filter(m => !m.sent);
    const count = pending.length;
    if (count > 0) {
        if (powerSaveBlockerId == null) {
            powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
            console.log('[PowerSave] Started prevent-app-suspension (pending scheduled messages:', count, ')');
        }
    } else {
        if (powerSaveBlockerId != null) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            powerSaveBlockerId = null;
            console.log('[PowerSave] Stopped prevent-app-suspension');
        }
    }
}

// --- 2.3. Missed scheduled messages on startup (computer was off) ---
function checkMissedScheduledMessagesOnStartup() {
    const messages = store.get('scheduledMessages') || [];
    const now = new Date();
    const oneMinuteAgo = now.getTime() - 60000;
    const toRemove = [];
    const toNotify = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.sent) continue;
        if (!m.date || !m.time) continue;
        const [y, mo, d] = m.date.split('-').map(Number);
        const [h, min] = m.time.split(':').map(Number);
        const scheduledTime = new Date(y, mo - 1, d, h, min, 0, 0);
        if (scheduledTime.getTime() < oneMinuteAgo) {
            toRemove.push(i);
            if (m.sender) toNotify.push({ sender: m.sender, chatName: m.chatName });
        }
    }
    if (toRemove.length === 0) return;
    const updated = messages.filter((_, i) => !toRemove.includes(i));
    store.set('scheduledMessages', updated);
    updatePowerSaveBlocker();
    if (isUIWindowAvailable() && uiWindow) uiWindow.webContents.send('main:render-scheduled-messages', updated.filter(m => !m.sent));
    for (const { sender, chatName } of toNotify) {
        const isHebrew = /[\u0590-\u05FF]/.test(chatName || '');
        const msg = isHebrew
            ? `⚠️ פספסתי הודעה מתוזמנת ל${chatName} כי המחשב היה כבוי.`
            : `⚠️ I missed a scheduled message to ${chatName} because the computer was off.`;
        callSendNotification(sender, msg).catch(() => {});
    }
    console.log('[Startup] Removed', toRemove.length, 'missed scheduled message(s)');
}

// --- 3. Vercel Backend Integration (FIXED MAPPING) ---
// Base URL for Vercel API - must match the deployment where summarize-and-deliver and answer-question run (e.g. whatsapp-summary-backend.vercel.app). Override with env VERCEL_API_BASE if different.
const VERCEL_API_BASE = process.env.VERCEL_API_BASE || 'https://whatsapp-summary-backend.vercel.app';

async function callVercelBackend(chatName, messages, recipientInfoOverride = null) {
    const VERCEL_URL = `${VERCEL_API_BASE}/api/summarize-and-deliver`;
    
    const recipientInfo = recipientInfoOverride || {
        recipientPhoneNumber: store.get('globalSettings.recipientPhoneNumber'),
        recipientEmail: store.get('globalSettings.recipientEmail')
    };
    
    const payload = {
        chatName: chatName,
        messages: messages,
        // Match the "recipientInfo" object your Vercel code expects
        recipientInfo: recipientInfo
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

// --- 3.1. Vercel Question API Integration ---
async function callVercelQuestionAPI(chatName, messages, question, sender) {
    const VERCEL_URL = `${VERCEL_API_BASE}/api/answer-question`;
    
    const payload = {
        chatName: chatName,
        messages: messages,
        question: question,
        sender: sender // Send sender so server can send answer back via Twilio
    };

    console.log(`[Network] Sending question to Vercel for ${chatName}. Question: "${question}"`);
    console.log(`[Network] Payload check - chatName: "${chatName}", messages: ${Array.isArray(messages) ? messages.length : typeof messages}, question: "${question}"`);
    
    // Validate payload before sending
    if (!chatName || !messages || !Array.isArray(messages) || messages.length === 0 || !question) {
        const missing = [];
        if (!chatName) missing.push('chatName');
        if (!messages || !Array.isArray(messages) || messages.length === 0) missing.push('messages');
        if (!question) missing.push('question');
        throw new Error(`Invalid payload - missing: ${missing.join(', ')}`);
    }

    try {
        const response = await fetch(VERCEL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            // Try to read as text to see what we got
            const text = await response.text();
            console.error('[Network Error] Non-JSON response received:', text.substring(0, 200));
            throw new Error(`Server returned non-JSON response (status ${response.status}). The endpoint may not be deployed yet.`);
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Server Error ${response.status}`);
        return data; 
    } catch (error) {
        console.error('[Network Error]', error.message);
        return { answer: `[Error] ${error.message}`, error: true };
    }
}

// --- 3.2. Send notification via Vercel (confirmation, success, missed, list/edit/delete reply) ---
async function callSendNotification(to, message) {
    if (!to || !message) return;
    try {
        const response = await fetch(`${VERCEL_API_BASE}/api/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, message })
        });
        const data = response.ok ? await response.json() : { error: await response.text() };
        if (!response.ok) console.error('[Notification] Failed:', data.error);
    } catch (error) {
        console.error('[Notification] Error:', error.message);
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
    // Use local date for comparison (avoid UTC/day-boundary bugs)
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateMatch = localDate === scheduledMessage.date;
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
            
            prunePastScheduledMessages();
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

/**
 * Process a question for a specific chat: open chat, extract messages, call API, send answer.
 */
async function processQuestionForChat(chatName, question, sender) {
    try {
        // Ensure window exists before processing
        const windowReady = await ensureWhatsAppWindowExists();
        if (!windowReady) {
            console.log('[Question] WhatsApp window not available');
            return;
        }

        console.log(`[Question] Processing question for chat: "${chatName}"`);

        // Store question context for the response handler (store on window, not webContents, for consistency)
        if (isWhatsAppWindowAvailable() && whatsappWindow) {
            whatsappWindow._pendingQuestion = {
                chatName: chatName,
                question: question,
                sender: sender
            };

            // Send command to open chat and extract messages
            if (whatsappWindow.webContents) {
                whatsappWindow.webContents.send('app:command-answer-question', {
                    chatName: chatName,
                    question: question
                });
            }
        } else {
            throw new Error('Window not available at question processing time');
        }
    } catch (error) {
        console.error('[Question] Error in processQuestionForChat:', error);
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
    updatePowerSaveBlocker();
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
        updatePowerSaveBlocker();
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
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list-for-message', []);
        return;
    }
    
    // Mark that the next chat list response should be for scheduled messages
    if (whatsappWindow && whatsappWindow.webContents) {
        whatsappWindow.webContents._isForScheduledMessage = true;
    }
    
    try {
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('app:request-chat-list');
        }
    } catch (error) {
        console.error('[IPC] Error requesting chat list for message:', error);
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list-for-message', []);
        if (whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents._isForScheduledMessage = false;
        }
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
        // Already set up - don't automatically request chat list
        // Chat list will be requested only when user clicks the button
    }
});

ipcMain.on('whatsapp:response-chat-list', (event, list) => {
    // Only UI requests use this channel; resolve uses whatsapp:chat-list-for-resolve
    // Check if this response is for scheduled messages
    const isForScheduledMessage = event.sender._isForScheduledMessage;
    if (isForScheduledMessage) {
        // Clear the flag
        event.sender._isForScheduledMessage = false;
        // Send to scheduled message handler
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list-for-message', list);
    } else {
        // Regular chat list request
        if (uiWindow) uiWindow.webContents.send('main:render-chat-list', list);
    }
});

ipcMain.on('whatsapp:chat-list-for-resolve', (event, list) => {
    const arr = list || [];
    console.log('[Pusher Command] Received chat list for resolve:', arr.length, 'items');
    if (arr.length > 0) {
        const sample = arr.slice(0, 5).map((n, i) => `"${(n || '').trim()}"`).join(', ');
        console.log('[Pusher Command] Received list sample (first 5):', sample);
    }
    if (_chatListResolve) {
        _chatListResolve(arr);
        _chatListResolve = null;
    }
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
        
        const messages = store.get('scheduledMessages') || [];
        let removedMsg = null;
        let messageRemoved = false;
        const updatedMessages = messages.filter(msg => {
            if (!messageRemoved && msg.chatName === chatName && msg.sent === false) {
                messageRemoved = true;
                removedMsg = msg;
                return false;
            }
            return true;
        });
        if (removedMsg && removedMsg.sender) {
            const isHebrew = /[\u0590-\u05FF]/.test(removedMsg.chatName || '');
            const successText = isHebrew
                ? `✅ ההודעה ל${removedMsg.chatName} נשלחה בהצלחה!`
                : `✅ Your message to ${removedMsg.chatName} was sent successfully!`;
            callSendNotification(removedMsg.sender, successText).catch(() => {});
        }
        store.set('scheduledMessages', updatedMessages);
        updatePowerSaveBlocker();
        
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

// Handler for question answering: receive messages, call API, send answer via WhatsApp
ipcMain.on('whatsapp:messages-for-question', async (event, { chatName, question, messages }) => {
    console.log(`[Question] Received ${messages.length} messages for question about "${chatName}"`);
    
    if (!whatsappWindow || !whatsappWindow._pendingQuestion) {
        console.warn('[Question] No pending question context found');
        return;
    }

    const pendingQuestion = whatsappWindow._pendingQuestion;
    delete whatsappWindow._pendingQuestion;

    // Use question from pendingQuestion to ensure consistency
    const questionText = pendingQuestion.question || question;

    // Debug logging
    console.log(`[Question] Debug - chatName: "${chatName}", questionText: "${questionText}", messages count: ${messages ? messages.length : 'null'}`);
    if (messages && messages.length > 0) {
        console.log(`[Question] Debug - First message sample:`, JSON.stringify(messages[0]));
    }

    try {
        // Allow 0 messages - let the API handle it gracefully and return a helpful message
        if (!messages || messages.length === 0) {
            console.warn(`[Question] No messages found for chat "${chatName}". API will handle this gracefully.`);
        }

        // Call Vercel API to get answer (server will send it back via Twilio)
        const result = await callVercelQuestionAPI(chatName, messages, questionText, pendingQuestion.sender);
        
        if (result.error) {
            throw new Error(result.answer || 'Failed to get answer from API');
        }

        const answer = result.answer;
        const deliveryStatus = result.deliveryStatus || {};
        
        if (deliveryStatus.whatsapp && deliveryStatus.whatsapp.includes('sent')) {
            console.log(`[Question] ✅ Answer sent back to ${pendingQuestion.sender} via Twilio`);
        } else if (deliveryStatus.whatsapp) {
            console.warn(`[Question] ⚠️ WhatsApp delivery issue: ${deliveryStatus.whatsapp}`);
        }

        // Notify that question was answered
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('whatsapp:question-answered', {
                chatName: chatName,
                answer: answer,
                success: true
            });
        }
    } catch (error) {
        console.error('[Question] Error processing question:', error);
        
        // Notify about error
        if (isWhatsAppWindowAvailable() && whatsappWindow && whatsappWindow.webContents) {
            whatsappWindow.webContents.send('whatsapp:question-answered', {
                chatName: chatName,
                answer: null,
                success: false,
                error: error.message
            });
        }
    }
});

/**
 * Send a notification to the user when no messages are found for a chat.
 * Uses the Vercel backend (which has Twilio credentials) to send the notification.
 */
async function sendNoMessagesNotification(chatName, sender) {
    try {
        // Get recipient info from store
        const recipientPhoneNumber = store.get('globalSettings.recipientPhoneNumber');
        const recipientEmail = store.get('globalSettings.recipientEmail');
        
        // For on-demand summaries, use the sender from the command
        const recipientInfo = {
            recipientPhoneNumber: sender ? (sender.startsWith('whatsapp:') ? sender.replace('whatsapp:', '') : sender) : recipientPhoneNumber,
            recipientEmail: recipientEmail
        };
        
        // Call Vercel backend with empty messages - it will handle sending the notification
        const result = await callVercelBackend(chatName, [], recipientInfo);
        
        if (result.error) {
            console.error('[No Messages] Error calling Vercel backend:', result.error);
        } else {
            console.log(`[No Messages] Notification sent via Vercel backend for chat "${chatName}"`);
        }
    } catch (error) {
        console.error('[No Messages] Error sending notification:', error);
    }
}

ipcMain.on('whatsapp:response-messages', async (event, messages) => {
    if (!currentlyRunningChat) return;
    
    // Check if no messages were found
    if (!messages || messages.length === 0) {
        console.log(`[Automation] No messages found for chat: ${currentlyRunningChat.name}`);
        
        // Send notification to user if this is an on-demand summary (from Pusher command)
        if (currentlyRunningChat.frequency === 'on-demand' && currentlyRunningChat._onDemandSender) {
            await sendNoMessagesNotification(currentlyRunningChat.name, currentlyRunningChat._onDemandSender);
        }
        
        // Update UI status
        if (isUIWindowAvailable()) {
            try {
                uiWindow.webContents.send('main:automation-status', { 
                    message: `No messages found for ${currentlyRunningChat.name}` 
                });
            } catch (error) {
                console.error('[IPC] Error sending automation status:', error);
            }
        }
        
        // Continue to next chat in queue
        if (isWhatsAppWindowAvailable()) {
            setTimeout(async () => {
                try {
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
            }, 1000);
        } else {
            console.log('[Automation] WhatsApp window destroyed, stopping automation');
            chatQueue = [];
            currentlyRunningChat = null;
        }
        return;
    }
    
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
    
    if (store.get('globalSettings.isSetupComplete')) {
        startAutomationLoop();
        checkMissedScheduledMessagesOnStartup();
    }
    updatePowerSaveBlocker();
    setupPusherListener();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });