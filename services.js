'use strict';

const SERVICES = [
  [/NETFLIX/, 'Netflix', 'Streaming'], [/SHOWMAX/, 'Showmax', 'Streaming'], [/DISNEY/, 'Disney+', 'Streaming'], [/AMAZON ?PRIME|PRIME VIDEO/, 'Amazon Prime', 'Streaming'],
  [/YOUTUBE|GOOGLE \*? ?YOUTUBE/, 'YouTube Premium', 'Streaming'], [/APPLE TV/, 'Apple TV+', 'Streaming'], [/DSTV|MULTICHOICE/, 'DStv', 'TV'],
  [/SPOTIFY/, 'Spotify', 'Music'], [/DEEZER/, 'Deezer', 'Music'], [/APPLE MUSIC/, 'Apple Music', 'Music'], [/TIDAL/, 'Tidal', 'Music'],
  [/APPLE\.COM|ITUNES|APPLE SERVICES|ICLOUD/, 'Apple', 'Apps and cloud'], [/GOOGLE ?\*|GOOGLE STORAGE|GOOGLE ONE|GOOGLE PLAY/, 'Google', 'Apps and cloud'],
  [/MICROSOFT|MSFT|OFFICE 365|XBOX/, 'Microsoft', 'Apps and cloud'], [/ADOBE/, 'Adobe', 'Software'], [/DROPBOX/, 'Dropbox', 'Apps and cloud'],
  [/OPENAI|CHATGPT/, 'ChatGPT', 'Software'], [/CANVA/, 'Canva', 'Software'], [/ZOOM\.US|ZOOM VIDEO/, 'Zoom', 'Software'], [/NORDVPN|EXPRESSVPN|SURFSHARK/, 'VPN', 'Software'],
  [/PLAYSTATION|PSN\b|NINTENDO|STEAM|EA PLAY/, 'Gaming', 'Gaming'], [/DUOLINGO/, 'Duolingo', 'Education'], [/UDEMY|COURSERA|SKILLSHARE/, 'Online learning', 'Education'],
  [/VIRGIN ACTIVE/, 'Virgin Active', 'Gym'], [/PLANET FITNESS/, 'Planet Fitness', 'Gym'], [/\bGYM\b|FITNESS|CRUNCH|ANYTIME/, 'Gym', 'Gym'],
  [/DISCOVERY (HEALTH|VITALITY|LIFE|INSURE)|VITALITY/, 'Discovery', 'Insurance'], [/OLD MUTUAL/, 'Old Mutual', 'Insurance'], [/SANLAM/, 'Sanlam', 'Insurance'],
  [/LIBERTY/, 'Liberty', 'Insurance'], [/MOMENTUM/, 'Momentum', 'Insurance'], [/OUTSURANCE/, 'Outsurance', 'Insurance'], [/DIALDIRECT/, 'DialDirect', 'Insurance'],
  [/HOLLARD/, 'Hollard', 'Insurance'], [/MIWAY/, 'MiWay', 'Insurance'], [/FUNERAL|LIFE COVER|ASSURANCE|INSURANCE/, 'Insurance', 'Insurance'],
  [/VODACOM/, 'Vodacom', 'Phone and internet'], [/\bMTN\b/, 'MTN', 'Phone and internet'], [/TELKOM/, 'Telkom', 'Phone and internet'], [/CELL ?C/, 'Cell C', 'Phone and internet'],
  [/AFRIHOST/, 'Afrihost', 'Phone and internet'], [/WEBAFRICA/, 'Webafrica', 'Phone and internet'], [/VUMATEL/, 'Vumatel', 'Phone and internet'], [/\bRAIN\b/, 'Rain', 'Phone and internet'], [/OPENSERVE/, 'Openserve', 'Phone and internet'], [/MWEB/, 'MWEB', 'Phone and internet'], [/RSAWEB/, 'RSAWEB', 'Phone and internet'], [/FIBRE/, 'Fibre', 'Phone and internet'],
  [/NAMECHEAP/, 'Namecheap', 'Software'], [/GODADDY/, 'GoDaddy', 'Software'], [/WIX\.COM/, 'Wix', 'Software'], [/SQUARESPACE/, 'Squarespace', 'Software'], [/DOMAINS?\b|HOSTING/, 'Domains and hosting', 'Software'], [/NEWS24|DAILY MAVERICK|NEW YORK TIMES|MEDIUM\.COM|SUBSTACK/, 'News and reading', 'News'],
];

const KNOWN = SERVICES.map(([re, label, cat]) => ({ re, label, cat }));

const GUIDES = [
  { id: 'netflix', name: 'Netflix', steps: ['Sign in at netflix.com on a browser.', 'Open Account, then Cancel Membership.', 'You keep access until the end of the period you paid for.'] },
  { id: 'spotify', name: 'Spotify', steps: ['Sign in at spotify.com and open Account.', 'Choose Manage plan, then Cancel Premium.', 'If you pay through your phone company or Apple, cancel there instead.'] },
  { id: 'apple', name: 'Apple subscriptions', steps: ['On iPhone: Settings, tap your name, then Subscriptions.', 'Pick the subscription and tap Cancel Subscription.', 'Charges listed as APPLE.COM/BILL are from here.'] },
  { id: 'google', name: 'Google Play and YouTube', steps: ['Open the Play Store and tap your profile picture.', 'Choose Payments and subscriptions, then Subscriptions.', 'Select it and tap Cancel subscription.'] },
  { id: 'dstv', name: 'DStv and Showmax', steps: ['Use the DStv app or website, or phone them.', 'Ask for the cancellation to be confirmed in writing or by email.', 'Cancellations can take effect at the end of the month, and a notice period may apply. Check your contract.'] },
  { id: 'gym', name: 'Gyms and clubs', steps: ['Find your contract and read the cancellation clause.', 'Send written notice by email and keep the reply.', 'In South Africa, the Consumer Protection Act generally lets you cancel a fixed-term agreement with 20 business days written notice, and the business may charge a reasonable penalty. This is general information, not legal advice.'] },
  { id: 'insurance', name: 'Insurance and funeral cover', steps: ['Do not cancel cover until you have replacement cover, if you still need it.', 'Ask the provider for their cancellation form or email address.', 'Cancel in writing, then ask your bank to stop the debit order.'] },
  { id: 'phone', name: 'Phone and internet contracts', steps: ['Check when your contract ends. Cancelling early may cost a fee.', 'Send the cancellation request to the address in your contract.', 'Ask for the final amount in writing.'] },
];

module.exports = { KNOWN, GUIDES };
