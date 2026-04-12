export type UserChangelogEntry = {
  date: string;
  title: string;
  summary: string;
  highlights: string[];
};

export const userChangelogEntries: UserChangelogEntry[] = [
  {
    date: '2026-04-11',
    title: 'More reliable moderation unlock after save',
    summary: 'Public and semi-public activities now recover better when moderation auto-run does not fire on first save.',
    highlights: [
      'Create/edit now retries automatic moderation once after save before giving up.',
      'If moderation auto-run still fails, hosts now see a clear warning instead of a silent stuck pending state.',
      'Activity settings now include a direct `Retry moderation now` action.',
      'Copied public and semi-public activities now auto-run moderation too, instead of waiting for manual admin re-run.',
      'Admin moderation now shows explicit public-browse gate checks to make hidden-state debugging faster.',
      'Internal moderation telemetry now records only minimal runtime outcome data, with no private activity content.',
    ],
  },
  {
    date: '2026-04-11',
    title: 'Clearer Verify with WhatsApp steps',
    summary: 'The WhatsApp verification flow now explains each step more clearly and stays aligned with Lalo updates.',
    highlights: [
      'Verify with WhatsApp screens now give clearer step-by-step guidance during the handoff flow.',
      'The flow text better explains when to send the WhatsApp message and when to return to the app.',
      'WhatsApp verify UI updates are now pulled from the Lalo server at build time, so messaging stays in sync.',
    ],
  },
  {
    date: '2026-04-11',
    title: 'Cleaner profile editing and smarter My Activities default',
    summary: 'This update makes account edits feel lighter and sends you to the most useful My Activities tab first.',
    highlights: [
      'Profile name and email are now locked by default with compact inline edit buttons.',
      'Each field now has its own clear save action, so you can update one detail at a time.',
      'Saving without changes no longer triggers unnecessary profile update calls.',
      'The Profile screen removes extra helper copy and visual clutter around account details.',
      'My Activities now opens on Attending automatically when you do not have upcoming hosted activities.',
    ],
  },
  {
    date: '2026-04-11',
    title: 'Clearer moderation transparency and safer resets',
    summary: 'Moderation tools now provide clearer public accountability and avoid stale manual states.',
    highlights: [
      'Public moderation history now shows moderator names more clearly when profile names are available.',
      'Admin moderation review cards now show better public-view context and timeline details.',
      'Manual moderation decisions now include a required public explanation prompt in the admin flow.',
      'Moderation overrides now reset more safely when important public-facing activity content changes.',
    ],
  },
  {
    date: '2026-04-09',
    title: 'Better WhatsApp login reliability and richer share links',
    summary: 'This release improves WhatsApp sign-in stability and upgrades activity sharing shortcuts.',
    highlights: [
      'WhatsApp sign-in now prefers direct auth-session handoff instead of rotating passwords each time.',
      'Shared activity links now support compact map and calendar shortcut routes.',
      'A dedicated shortcut page can open location, launch Google Calendar, or download .ics files.',
      'Private WhatsApp share messages now include richer context and clearer action links.',
    ],
  },
  {
    date: '2026-04-07',
    title: 'Easier updates, clearer hosting tools',
    summary: 'This release makes the app easier to trust and easier to manage behind the scenes.',
    highlights: [
      'There is now a Changelog page in the menu so you can quickly see what changed.',
      'Activity locations are now more consistent, with public location currently locked to Hoi An, Vietnam for new and updated activities.',
      'Signed-in sessions recover more cleanly, so expired logins are handled with clearer messages instead of confusing broken states.',
      'Hosts now see more reliable attendee and interest counts in My Activities.',
      'Admins can reach internal tools more directly from the top-right menu.',
    ],
  },
  {
    date: '2026-03-30',
    title: 'Smoother joining, profiles, and host setup',
    summary: 'A big release focused on making joining activities simpler while cleaning up profile and host flows.',
    highlights: [
      'Hosts can now decide whether guest email is required or optional for each activity.',
      'Guests can join more easily with just a name when the host allows it, and add email later for recovery.',
      'Profile and host name handling became more reliable, especially after magic-link sign-in.',
      'My Activities now shows clearer labels, better visibility badges, and stronger recovery prompts for guest accounts.',
      'Calendar actions and mobile form behavior were polished to feel more stable and easier to use.',
    ],
  },
  {
    date: '2026-03-29',
    title: 'Better post-create host flow',
    summary: 'The host dashboard now behaves more reliably right after creating an activity.',
    highlights: [
      'The post-create success modal now appears properly on the real host dashboard.',
      'Quick next steps like sharing on WhatsApp or returning to My Activities are easier to use.',
      'The WhatsApp action layout was tightened up for mobile screens.',
    ],
  },
  {
    date: '2026-03-28',
    title: 'Smarter location tools and clearer create flow',
    summary: 'This release improved how activities are created, discovered, and reviewed.',
    highlights: [
      'Hosts can paste a Google Maps link to quickly fill in location details.',
      'The create flow is now split into clearer steps, with visibility chosen first.',
      'Public activity browsing is easier to scan with Today, Tomorrow, weekday, and Later grouping.',
      'Moderation tooling became clearer and more transparent for public-facing activity review.',
      'Hosts now have better support for approval-required join requests, including proxy joins.',
    ],
  },
  {
    date: '2026-03-27',
    title: 'Home page and dashboard refresh',
    summary: 'The app became easier to navigate for both hosts and attendees.',
    highlights: [
      'The home page now works as the public front door for everyone, including signed-in users.',
      'Signed-in hosting and attending moved into My Activities for a cleaner main flow.',
      'Public browsing gained moderation transparency links and better control over what is visible.',
      'Hosts can now require approval before someone joins an activity.',
      'A new feedback flow lets people send ideas and bug reports directly from the home page.',
    ],
  },
  {
    date: '2026-03-24',
    title: 'Public moderation and discovery foundation',
    summary: 'This release added the first serious moderation and discovery controls for public-facing activities.',
    highlights: [
      'The app now has a public moderation transparency page.',
      'Public and semi-public activities gained lightweight AI moderation support.',
      'Public discovery is now gated more carefully so not every public-capable activity shows up automatically.',
      'Admins got early moderation review tools to help manage public visibility decisions.',
    ],
  },
];
