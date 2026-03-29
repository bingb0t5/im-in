export const WHATSAPP_READY_SELECTOR = [
  'div[role="textbox"][title*="Search"]',
  'div[aria-label="Chat list"]',
  "#pane-side",
].join(", ");

export const WHATSAPP_SESSION_EXPIRED_SELECTOR = [
  'canvas[aria-label*="Scan"]',
  '[data-testid="qrcode"]',
  '[data-ref] canvas',
].join(", ");

export const WHATSAPP_SEARCH_BOX_SELECTORS = [
  '#side div[role="textbox"][contenteditable="true"]',
  'div[role="textbox"][aria-label*="Search"]',
  'div[contenteditable="true"][aria-label*="Search"]',
  'div[contenteditable="true"][title*="Search"]',
  'input[aria-label*="Search"]',
  'input[placeholder*="Search"]',
  'div[aria-label="Search input textbox"]',
  '#side div[contenteditable="true"]',
];

export const WHATSAPP_COMPOSER_SELECTORS = [
  '#main footer div[contenteditable="true"]',
  '#main [data-testid="conversation-compose-box-input"]',
  '#main footer [role="textbox"]',
];

export const WHATSAPP_GROUP_TITLE_SELECTORS = [
  '#main header span[title]',
  '#main header [dir="auto"]',
  '#main header h1',
];

export const WHATSAPP_JOIN_GROUP_BUTTON_SELECTORS = [
  'button:has-text("Join group")',
  '[role="button"]:has-text("Join group")',
  'button:has-text("Join chat")',
  '[role="button"]:has-text("Join chat")',
];

export const WHATSAPP_CONTINUE_TO_WEB_SELECTORS = [
  'a:has-text("Continue to WhatsApp Web")',
  'button:has-text("Continue to WhatsApp Web")',
  '[role="button"]:has-text("Continue to WhatsApp Web")',
  'a:has-text("Continue to Chat")',
  'button:has-text("Continue to Chat")',
  '[role="button"]:has-text("Continue to Chat")',
];

export const WHATSAPP_OPEN_GROUP_BUTTON_SELECTORS = [
  'button:has-text("Open group")',
  '[role="button"]:has-text("Open group")',
  'button:has-text("View group")',
  '[role="button"]:has-text("View group")',
  'button:has-text("Open chat")',
  '[role="button"]:has-text("Open chat")',
];

export const WHATSAPP_INVALID_INVITE_SELECTORS = [
  'text=Invite link is invalid',
  'text=Group invite link is invalid',
  'text=This invite link is invalid',
  'text=Link is invalid',
  'text=This link is invalid',
];

export const WHATSAPP_JOIN_APPROVAL_SELECTORS = [
  'text=Request to join',
  'text=Ask to join',
  'text=Admin approval',
];
