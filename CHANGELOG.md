# Playr — Changelog

A running log of every change made to the platform. Written in plain English so the whole team can follow along.

---

## 2026-03-31

### Fix: nudge card vertical text on mobile (network home)
On small phone screens the profile completion nudge card ("Add your highlight reel to get 3× more scout views") was showing text one character per line. Root cause: the non-shrinking action button next to the text was wider than the available space, collapsing the text container to near-zero width.

- Nudge card now wraps: if the button can't fit beside the text, it drops to its own full-width line below the message.
- Minimum text body width set to `140px` so the button always wraps rather than crushing the text.
- Status card on mobile now stacks vertically (ring centred at top, info full-width below) — this gives the nudge card the full card width to work with.
- Ring avatar reduced from 100px to 72px on mobile.
- FAB "+" button moved to bottom-right corner on mobile so it no longer sits centred over feed content.
- All nudge card variants (highlights, bio, position, etc.) benefit from this fix automatically.

---

## 2026-03-30 (2)

### Separated Home feed and Discover pages

**Home (Feed tab)**
Removed the search bar and "All / Players / Scouts / Coaches / Clubs" filter chips from the Home screen. The feed now shows only posts, updates, trial announcements, and content — no search UI anywhere on this page. Feels like an Instagram or Twitter feed. The "Post Update" composer is still at the top.

**Discover tab**
The Discover tab now opens the full Discover page (previously it opened "My Network"). The search bar is larger and more prominent — full width with a green focus glow. Filter chips (All, Players, Scouts, Coaches, Clubs) sit immediately below. As the user types, results filter in real time. When no search is typed yet, three suggested sections appear: "Scouts looking for your position", "Players near you", and "Verified coaches" — each with an invite button so the network can grow.

**Navigation**
Both pages are clearly labelled and separated in the desktop sidebar and mobile bottom nav bar. Home = feed. Discover = search and find people.

---

## 2026-03-30

### Full DM messaging system (replaces floating chat popup)
The old floating chat widget has been removed entirely and replaced with a proper dedicated Messages page, styled like Instagram or iMessage.

- **Desktop:** Clicking the Messages icon in the sidebar opens a full two-column Messages screen. The left column shows all conversations with profile avatar, name, last message preview, timestamp, and an unread badge. The right column shows the open chat thread — messages bubble left and right depending on who sent them, timestamps under each bubble. The input bar is fixed at the bottom of the thread with a text field, emoji button, and send button.
- **Mobile:** Tapping Messages in the bottom nav opens the conversations list full screen. Tapping a conversation slides into the thread full screen with a back arrow (‹) in the header to return to the list. The chat bubbles use the app's green accent (`#00FF87`) for sent messages and a dark card for received messages.
- **No floating overlay anywhere:** The floating messaging popup that used to appear over every screen has been completely removed — no overlay, no z-index wars.
- **Messages persist:** Sent messages are stored in localStorage and pushed to the database (`/api/messages`) as before. Unread count badge on the Messages nav icon still updates in real time.

---

## 2026-03-29

### EAF mobile bottom navigation
The Elite Athlete Framework now has a proper mobile navigation bar at the bottom of the screen. Previously, users on a phone were stuck with no way to move between sections. Now there are 6 clearly labelled tabs at the bottom — Home, Modules, Progress, Journal, Explore, and Stories — styled exactly like the Athlete Discovery Network's navigation bar. The active tab highlights in green. Works on all screens under 768px wide; desktop sidebar is completely unchanged.

---

## 2026-03-28

### Pathway switcher (switch between EAF and ADN)
Added a persistent way for users to switch between the two pathways from anywhere in the app.

- **Desktop:** The sidebar now shows labelled "Framework" and "Network" buttons at the bottom with icons, so users always know they can switch.
- **Mobile (inside Network):** The Profile tab now has a full-width "Switch to Elite Athlete Framework" button at the bottom of the screen.
- **Mobile (inside EAF):** The top bar now shows a green "Network →" button on the right, giving users a clear escape route back to the Discovery Network. Previously there was no way to switch at all on mobile.

### Complete desktop/mobile layout separation
Audited and fixed every place where desktop styles were bleeding into mobile and vice versa:

- Fixed a padding inconsistency where the bottom spacing on screens was 62px but the navigation bar is 68px tall — content was being slightly hidden behind the nav bar.
- Removed a chat drawer positioning rule that was running at the wrong screen size.
- Explicitly hid the desktop sidebar on mobile (it was only hidden at a wider breakpoint before, not the main 768px mobile breakpoint).
- The EAF screen now correctly pushes its content below the fixed top bar on mobile.
- The EAF sticky header now sits below the mobile top bar rather than overlapping it.

### EAF mobile bottom navigation (foundations)
Built the technical groundwork for the EAF mobile nav — show/hide logic, active state syncing, and content padding so the last item on screen is never hidden behind the navigation bar.

---

## 2026-03-27

### Fix: mobile bottom navigation (ADN)
The bottom navigation bar in the Athlete Discovery Network was broken — labels were hidden, making icons meaningless, and users couldn't tell what each tab did.

- Labels now always show beneath each icon.
- Bar height increased from 62px to 68px so icons and labels both have breathing room.
- 5 tabs visible: Home, Discover, Map, Messages, Profile.
- Active tab highlights in green with a small accent line at the top.
- All screen content updated to have the correct bottom padding so nothing hides behind the bar.

### Remove floating audio player and messaging widget on mobile
The audio player bar (headphones) and the chat messaging bubble were floating over the screen on mobile and couldn't be dismissed. Both are now completely removed from the mobile UI. On desktop, the messaging widget has been moved to sit alongside the sidebar rather than floating over the main content.

### Fix: landing page layout on mobile
The landing page had multiple layout problems on phones:

- The Playr logo was overlapping the headline text.
- The stats bar (12K+ Athletes, 580+ Scouts etc.) was a 4-column row that caused the "Women's + Men's" stat to wrap or get cut off. It's now a clean 2×2 grid.
- The two path cards (Elite Athlete Framework and Athlete Discovery Network) stack vertically and each take full width.
- The "Enter the framework" and "Join the network" buttons are now proper full-width tappable buttons (48px minimum height).
- The page is now scrollable on small screens rather than clipping content.

### Mobile responsiveness — full pass
First comprehensive mobile pass across the entire platform:

- Fixed bottom navigation bar for the ADN (Instagram-style, 5 tabs).
- Mobile top bar showing Playr logo + profile avatar on network screens.
- All multi-column layouts collapse to single column.
- Map filter bar scrolls horizontally instead of wrapping.
- Daily check-in and modals appear as bottom sheets (slide up from bottom).
- Buttons are a minimum of 48px tall for easy tapping.
- Horizontal scrolling prevented globally.

### Backup created
Backed up `playr-platform.html` and `server.js` into `/backup-desktop` before making changes.

---

## 2026-03-26

### Remove fake placeholder users
Removed all hardcoded fake profiles from the Athlete Discovery Network — Lisa Chen, James Harrison, FC Velocity Academy, Sarah Okonkwo, Ryan Morris, and all others. The platform now has clean empty states:

- **Scouts & Clubs section:** Shows "No connections yet — the network grows when you invite people who matter to your career." with an Invite Someone button.
- **Discovery page:** Shows "Be one of the first on Playr — the scouts and players are coming." when no real users exist.
- **Invite modal:** Share link via copy, WhatsApp, SMS, or Email.

### Revert: map upgrade (Leaflet)
A Leaflet.js map upgrade was pushed but then reverted after review — the 3D globe was removed unintentionally. The original Globe.gl 3D globe has been restored.

---

*This file is updated with every deployment. Most recent changes appear at the top.*
