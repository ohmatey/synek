// Rebuild + enrich the "Martech landscape" timeline directly in the DB (the live
// MCP build was lost when the running server's ephemeral DB crashed). Uses the same
// db-layer the MCP apply_patch handler uses — PatchBuilder + applyOps (refs resolve
// within the batch) + commitPatch — then writes a narrative story. Owned by the demo
// account (the owner of the seeds this user was working alongside).
//   bunx tsx scripts/build-martech.ts
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { user, timelines } from '../src/lib/db/schema'
import { createTimeline, loadGraph, setTimelineView } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { writeStory, type NewStorySegment } from '../src/lib/db/stories'

const OWNER_EMAIL = process.env.SYNEK_DEMO_EMAIL || 'demo@synek.app'

const owner = db.select({ id: user.id }).from(user).where(eq(user.email, OWNER_EMAIL)).get()
if (!owner) throw new Error(`no user ${OWNER_EMAIL} in this DB`)

const tl = createTimeline('Martech landscape', owner.id)
console.log(`created timeline ${tl.id} owned by ${OWNER_EMAIL}`)

// --- the full graph: 6 era bands, vendor swimlanes, independents, data/CDP, ---
// --- industry milestones, concepts, people, plus the enrichment additions. ---
const ops: any[] = [
  // ERAS
  { op: 'add_node', ref: 'era1', type: 'period', title: 'Pre-Digital Marketing', start: '1980', end: '1993', precision: 'year', geoScope: 'global', summary: 'Broadcast TV, print and direct mail dominate. The 1980s see the birth of database marketing — the first time stored customer data drives targeting and the seed of everything martech becomes.' },
  { op: 'add_node', ref: 'era2', type: 'period', title: 'Web 1.0 & Email', start: '1994', end: '2003', precision: 'year', geoScope: 'global', summary: 'The web arrives: the first banner ads, email blasts, and rudimentary web analytics. Marketing becomes digital and, for the first time, click-measurable. Dot-com boom and bust.' },
  { op: 'add_node', ref: 'era3', type: 'period', title: 'Search & Social', start: '2004', end: '2010', precision: 'year', geoScope: 'global', summary: 'Google AdWords scales auction-based paid search; Facebook opens advertising. Free analytics democratizes measurement. Marketing becomes biddable, targetable, and accountable to ROI.' },
  { op: 'add_node', ref: 'era4', type: 'period', title: 'The Martech Explosion', start: '2011', end: '2017', precision: 'year', geoScope: 'global', summary: "Marketing automation, 'marketing clouds,' and programmatic adtech proliferate. Scott Brinker's landscape balloons from ~150 vendors (2011) to 5,000+ (2017). The buying giants assemble suites by acquisition." },
  { op: 'add_node', ref: 'era5', type: 'period', title: 'Privacy Reckoning & First-Party Data', start: '2018', end: '2022', precision: 'year', geoScope: 'global', summary: "GDPR, CCPA, Apple's App Tracking Transparency, and looming cookie deprecation break third-party tracking. The industry pivots to consented, first-party data and Customer Data Platforms." },
  { op: 'add_node', ref: 'era6', type: 'period', title: 'AI-Native & Agentic Marketing', start: '2023', end: '2030', precision: 'year', geoScope: 'global', summary: 'Generative AI and copilots reshape content, segmentation, and analytics. The emerging direction is agentic marketing — autonomous systems that plan and execute campaigns — atop unified first-party data.' },
  // CONCEPTS
  { op: 'add_node', ref: 'concept_inbound', type: 'concept', title: 'Inbound Marketing', start: '2005', precision: 'year', geoScope: 'global', summary: 'The doctrine of earning attention with useful content (pull) instead of buying it (push). Articulated by HubSpot\'s founders; it reframed marketing around being found via search and social.', citations: [{ title: 'Inbound Marketing — Halligan & Shah', sourceType: 'scholarship' }] },
  { op: 'add_node', ref: 'concept_programmatic', type: 'concept', title: 'Programmatic Advertising (RTB)', start: '2009', precision: 'year', geoScope: 'global', summary: 'Automated, auction-based buying of individual ad impressions in real time via DSPs/SSPs and ad exchanges. It turned display advertising into a data-driven, machine-mediated market.' },
  { op: 'add_node', ref: 'concept_cdp', type: 'concept', title: 'Customer Data Platform (CDP)', start: '2013', precision: 'year', geoScope: 'global', summary: 'Packaged software that unifies first-party customer data into a persistent, shareable profile other tools can act on. It became the backbone of privacy-era marketing as third-party data collapsed.', citations: [{ title: 'CDP Institute — definition of a Customer Data Platform', sourceType: 'scholarship' }] },
  // PEOPLE
  { op: 'add_node', ref: 'brinker', type: 'entity', subtype: 'person', lane: 'Industry & milestones', title: 'Scott Brinker', start: '2008', precision: 'year', location: 'Lexington, Massachusetts', lat: 42.45, lng: -71.23, summary: "Editor of chiefmartec and 'godfather of martech.' From 2011 he charted the annual Marketing Technology Landscape, the canonical visual record of the field's vendor explosion." },
  // INDUSTRY & MILESTONES
  { op: 'add_node', ref: 'ev_banner', type: 'event', lane: 'Industry & milestones', title: 'First web banner ad (AT&T on HotWired)', start: '1994-10', precision: 'month', location: 'HotWired, San Francisco', lat: 37.77, lng: -122.42, summary: "On 27 Oct 1994, AT&T's banner ran on HotWired — the first paid web ad. Reported click-through near 44%. The web ad economy begins.", citations: [{ title: 'The first banner ad (HotWired / AT&T, 1994)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'ev_landscape2011', type: 'event', lane: 'Industry & milestones', title: 'First Marketing Technology Landscape (~150 vendors)', start: '2011', precision: 'year', geoScope: 'diffuse', summary: 'Scott Brinker publishes the first martech landscape graphic — roughly 150 logos. It becomes the yardstick for the field\'s runaway growth.', citations: [{ title: 'chiefmartec — Marketing Technology Landscape 2011', sourceType: 'scholarship' }] },
  { op: 'add_node', ref: 'ev_landscape2017', type: 'event', lane: 'Industry & milestones', title: "'Martech 5,000' (5,381 vendors)", start: '2017', precision: 'year', geoScope: 'diffuse', summary: "The landscape passes 5,000 logos — the nickname 'Martech 5000' sticks — a symbol of extreme fragmentation. It would exceed 14,000 by the mid-2020s despite predictions of consolidation.", citations: [{ title: 'chiefmartec — Marketing Technology Landscape 2017', sourceType: 'scholarship' }] },
  { op: 'add_node', ref: 'ev_gdpr', type: 'event', lane: 'Industry & milestones', title: 'GDPR takes effect', start: '2018-05', precision: 'month', location: 'European Union', lat: 50.85, lng: 4.35, summary: "The EU's General Data Protection Regulation makes consent and data rights enforceable with heavy fines, reshaping how customer data is collected, stored, and used worldwide.", citations: [{ title: 'Regulation (EU) 2016/679 (GDPR)', sourceType: 'primary' }] },
  { op: 'add_node', ref: 'ev_ccpa', type: 'event', lane: 'Industry & milestones', title: 'CCPA in effect', start: '2020-01', precision: 'month', location: 'California', lat: 38.58, lng: -121.49, summary: 'The California Consumer Privacy Act — the first major US state privacy regime — gives consumers rights to know, delete, and opt out of the sale of their data.' },
  { op: 'add_node', ref: 'ev_cookie_announce', type: 'event', lane: 'Industry & milestones', title: 'Google to deprecate third-party cookies in Chrome', start: '2020-01', precision: 'month', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: "Google announces it will phase out third-party cookies in Chrome — the dominant browser — threatening the cross-site tracking that underpins display advertising and forcing a first-party-data pivot.", citations: [{ title: 'Google — Building a more private web (2020)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'ev_att', type: 'event', lane: 'Industry & milestones', title: 'Apple App Tracking Transparency (iOS 14.5)', start: '2021-04', precision: 'month', location: 'Cupertino, California', lat: 37.33, lng: -122.03, summary: 'Apple requires apps to ask permission before tracking. Most users decline, gutting the IDFA-based targeting and measurement that mobile advertising relied on.', citations: [{ title: 'Apple — App Tracking Transparency (iOS 14.5)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'ev_chatgpt', type: 'event', lane: 'Industry & milestones', title: 'ChatGPT launches', start: '2022-11-30', precision: 'day', location: 'San Francisco, California', lat: 37.78, lng: -122.41, summary: "OpenAI's ChatGPT takes generative AI mainstream, igniting an AI arms race across martech — content generation, segmentation, copilots, and the first agentic-marketing pitches.", citations: [{ title: 'OpenAI — Introducing ChatGPT (Nov 2022)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'ev_cookie_reverse', type: 'event', lane: 'Industry & milestones', title: 'Google reverses course, keeps third-party cookies', start: '2024-07', precision: 'month', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: 'After repeated delays, Google abandons full third-party-cookie deprecation in Chrome, opting for a user-choice model. Adtech\'s biggest planned shift stalls — but the first-party-data direction is already set.', citations: [{ title: 'Google — update on Privacy Sandbox / cookies (2024)', sourceType: 'press' }] },
  // GOOGLE
  { op: 'add_node', ref: 'org_google', type: 'entity', subtype: 'org', lane: 'Google', title: 'Google', start: '1998', precision: 'year', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: 'Founded 1998. Built the dominant marketing stack of the era: auction-based paid search (AdWords), free analytics, and — via DoubleClick — display and ad-serving infrastructure.' },
  { op: 'add_node', ref: 'g_adwords', type: 'event', lane: 'Google', title: 'Google AdWords launches', start: '2000-10', precision: 'month', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: "Self-serve, auction-based search ads tied to keywords. It becomes the engine of search marketing and Google's core business — performance marketing's defining channel.", citations: [{ title: 'Google AdWords launch (2000)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'g_analytics', type: 'event', lane: 'Google', title: 'Google acquires Urchin → Google Analytics', start: '2005', precision: 'year', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: 'Google buys Urchin and relaunches it as free Google Analytics, democratizing web measurement for millions of sites and standardizing how marketers track funnels.' },
  { op: 'add_node', ref: 'g_doubleclick', type: 'event', lane: 'Google', title: 'Google acquires DoubleClick', start: '2008', precision: 'year', location: 'New York, New York', lat: 40.71, lng: -74.01, summary: 'A ~$3.1B deal that hands Google the dominant ad-serving and display infrastructure, cementing its grip on programmatic display advertising.', citations: [{ title: 'Google completes DoubleClick acquisition (2008)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'g_ga4', type: 'event', lane: 'Google', title: 'Google Analytics 4', start: '2020-10', precision: 'month', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: 'An event-based, privacy-minded rebuild of Analytics designed for a cookieless, cross-device world. Universal Analytics is sunset in July 2023, forcing a mass migration.' },
  // ADOBE
  { op: 'add_node', ref: 'org_adobe', type: 'entity', subtype: 'org', lane: 'Adobe', title: 'Adobe', start: '2009', precision: 'year', location: 'San Jose, California', lat: 37.33, lng: -121.89, summary: 'A software giant (founded 1982) that entered martech in 2009 by buying Omniture and assembled the Experience Cloud through acquisitions — analytics, automation, and a real-time CDP.' },
  { op: 'add_node', ref: 'a_marketingcloud', type: 'event', lane: 'Adobe', title: 'Adobe Marketing Cloud', start: '2012', precision: 'year', location: 'San Jose, California', lat: 37.33, lng: -121.89, summary: "Adobe bundles Analytics (ex-Omniture), Target, Campaign, and Social into an integrated suite — the 'marketing cloud' model that defines the explosion era." },
  { op: 'add_node', ref: 'a_marketo', type: 'event', lane: 'Adobe', title: 'Adobe acquires Marketo', start: '2018-10', precision: 'month', location: 'San Jose, California', lat: 37.33, lng: -121.89, summary: 'A $4.75B deal adding best-in-class B2B marketing automation to the Experience Cloud, after Marketo had spent two years under Vista private equity.', citations: [{ title: 'Adobe to acquire Marketo for $4.75B (2018)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'a_aep', type: 'event', lane: 'Adobe', title: 'Adobe Experience Platform / Real-Time CDP', start: '2019', precision: 'year', location: 'San Jose, California', lat: 37.33, lng: -121.89, summary: "A first-party-data backbone unifying customer profiles across the Experience Cloud — Adobe's answer to the privacy era and the CDP category." },
  // SALESFORCE
  { op: 'add_node', ref: 'org_salesforce', type: 'entity', subtype: 'org', lane: 'Salesforce', title: 'Salesforce', start: '1999', precision: 'year', location: 'San Francisco, California', lat: 37.79, lng: -122.4, summary: 'The SaaS CRM pioneer (founded 1999). Expanded from sales into marketing via a string of acquisitions, then into a customer data platform and, latterly, generative + agentic AI.' },
  { op: 'add_node', ref: 's_exacttarget', type: 'event', lane: 'Salesforce', title: 'Salesforce acquires ExactTarget', start: '2013-06', precision: 'month', location: 'Indianapolis, Indiana', lat: 39.77, lng: -86.16, summary: 'A $2.5B deal that becomes the Salesforce Marketing Cloud. ExactTarget had just bought Pardot, so B2B marketing automation comes along too.', citations: [{ title: 'Salesforce to acquire ExactTarget for $2.5B (2013)', sourceType: 'press' }] },
  { op: 'add_node', ref: 's_krux', type: 'event', lane: 'Salesforce', title: 'Salesforce acquires Krux (→ Salesforce DMP)', start: '2016', precision: 'year', location: 'San Francisco, California', lat: 37.78, lng: -122.4, summary: 'Adds a data-management platform for audience data — an early bet on owning the customer-data layer that later becomes Data Cloud.' },
  { op: 'add_node', ref: 's_datacloud', type: 'event', lane: 'Salesforce', title: 'Salesforce Data Cloud (CDP)', start: '2022', precision: 'year', location: 'San Francisco, California', lat: 37.79, lng: -122.4, summary: "A real-time first-party customer data platform unifying data across the Customer 360 — Salesforce's privacy-era pivot from third-party audience data to owned profiles." },
  { op: 'add_node', ref: 's_einstein', type: 'event', lane: 'Salesforce', title: 'Einstein GPT → Agentforce', start: '2023', precision: 'year', location: 'San Francisco, California', lat: 37.79, lng: -122.4, summary: "Generative AI woven across CRM (Einstein GPT, 2023), then Agentforce (2024) — autonomous agents that act on marketing/service tasks. Salesforce's bet on agentic marketing.", citations: [{ title: 'Salesforce introduces Einstein GPT (2023)', sourceType: 'press' }] },
  // ORACLE
  { op: 'add_node', ref: 'org_oracle', type: 'entity', subtype: 'org', lane: 'Oracle', title: 'Oracle', start: '2012', precision: 'year', location: 'Redwood City, California', lat: 37.53, lng: -122.24, summary: 'The database/ERP giant (founded 1977) that built Oracle Marketing Cloud almost entirely by acquisition in 2012–2014 — then largely retreated from advertising as third-party data collapsed.' },
  { op: 'add_node', ref: 'o_eloqua', type: 'event', lane: 'Oracle', title: 'Oracle acquires Eloqua', start: '2012-12', precision: 'month', location: 'Redwood City, California', lat: 37.53, lng: -122.24, summary: "An ~$871M deal for the B2B marketing-automation pioneer — Oracle's opening move into the marketing cloud.", citations: [{ title: 'Oracle to acquire Eloqua for ~$871M (2012)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'o_responsys', type: 'event', lane: 'Oracle', title: 'Oracle acquires Responsys', start: '2013-12', precision: 'month', location: 'Redwood City, California', lat: 37.53, lng: -122.24, summary: 'A ~$1.5B deal adding B2C email and cross-channel campaign management to Oracle Marketing Cloud.', citations: [{ title: 'Oracle to acquire Responsys for ~$1.5B (2013)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'o_bluekai', type: 'event', lane: 'Oracle', title: 'Oracle acquires BlueKai', start: '2014-02', precision: 'month', location: 'Redwood City, California', lat: 37.53, lng: -122.24, summary: 'Adds a data-management platform and one of the largest third-party data marketplaces — a big bet on audience data that privacy law would later undermine.' },
  { op: 'add_node', ref: 'o_exit', type: 'event', lane: 'Oracle', title: 'Oracle shuts its advertising business (BlueKai/DMP)', start: '2022', precision: 'year', location: 'Redwood City, California', lat: 37.53, lng: -122.24, summary: 'Oracle winds down its advertising and third-party-data products as the cookieless, post-ATT world erodes their value — a marketing cloud visibly retreating from adtech.', citations: [{ title: 'Oracle shuts down its advertising business (2022)', sourceType: 'press' }] },
  // HUBSPOT
  { op: 'add_node', ref: 'org_hubspot', type: 'entity', subtype: 'org', lane: 'HubSpot', title: 'HubSpot', start: '2006', precision: 'year', location: 'Cambridge, Massachusetts', lat: 42.36, lng: -71.09, summary: "Founded 2006 by Brian Halligan and Dharmesh Shah; coined 'inbound marketing.' Built the SMB all-in-one platform (CRM + marketing + sales) and a freemium, product-led growth model." },
  { op: 'add_node', ref: 'h_inbound_book', type: 'event', lane: 'HubSpot', title: "'Inbound Marketing' book", start: '2009', precision: 'year', location: 'Cambridge, Massachusetts', lat: 42.36, lng: -71.09, summary: 'Halligan and Shah codify the inbound playbook — get found via content, SEO, and social rather than interrupting. It names a movement and HubSpot\'s category.', citations: [{ title: 'Inbound Marketing — Halligan & Shah (2009)', sourceType: 'scholarship' }] },
  { op: 'add_node', ref: 'h_ai', type: 'event', lane: 'HubSpot', title: 'HubSpot AI (ChatSpot → Breeze)', start: '2023', precision: 'year', location: 'Cambridge, Massachusetts', lat: 42.36, lng: -71.09, summary: 'HubSpot layers generative-AI copilots (ChatSpot, then the Breeze suite) across its platform — bringing AI-native marketing to small and mid-market teams.' },
  // META
  { op: 'add_node', ref: 'org_meta', type: 'entity', subtype: 'org', lane: 'Meta', title: 'Facebook (Meta)', start: '2004', precision: 'year', location: 'Menlo Park, California', lat: 37.48, lng: -122.15, summary: 'Founded 2004 (renamed Meta in 2021). Built the dominant social-advertising machine — granular interest and behavioral targeting at billions of users — until Apple\'s ATT undercut its tracking.' },
  { op: 'add_node', ref: 'm_ads', type: 'event', lane: 'Meta', title: 'Facebook Ads (self-serve) + Beacon', start: '2007-11', precision: 'month', location: 'Menlo Park, California', lat: 37.48, lng: -122.15, summary: "Facebook opens self-serve social advertising. The simultaneous Beacon program — broadcasting users' off-site purchases — sparks a privacy backlash that foreshadows the decade's fights.", citations: [{ title: 'Facebook launches Ads and Beacon (2007)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'm_customaud', type: 'event', lane: 'Meta', title: 'Facebook Custom Audiences', start: '2013', precision: 'year', location: 'Menlo Park, California', lat: 37.48, lng: -122.15, summary: 'Advertisers upload their own customer lists to target and retarget on Facebook — fusing first-party CRM data with social reach and supercharging direct-response advertising.' },
  { op: 'add_node', ref: 'm_pixel', type: 'event', lane: 'Meta', title: 'Facebook Pixel', start: '2015', precision: 'year', location: 'Menlo Park, California', lat: 37.48, lng: -122.15, summary: 'A site-wide tracking tag that ties web behavior and conversions back to ad spend — the backbone of measurable performance marketing on Facebook.' },
  { op: 'add_node', ref: 'm_atthit', type: 'event', lane: 'Meta', title: 'iOS ATT costs Meta ≈$10B/year', start: '2022', precision: 'year', location: 'Menlo Park, California', lat: 37.48, lng: -122.15, summary: "Meta says Apple's App Tracking Transparency will cut 2022 revenue by about $10B — the starkest proof that platform-level privacy changes can reprice an entire ad business.", citations: [{ title: 'Meta: ATT to cost ~$10B in 2022', sourceType: 'press' }] },
  // INDEPENDENTS (absorbed)
  { op: 'add_node', ref: 'ind_omniture', type: 'entity', subtype: 'org', lane: 'Independents (absorbed)', title: 'Omniture', start: '1996', end: '2009', precision: 'year', location: 'Orem, Utah', lat: 40.3, lng: -111.69, summary: 'The web-analytics pure-play (SiteCatalyst) that defined enterprise digital measurement — acquired by Adobe in 2009 for ~$1.8B to become Adobe Analytics.', citations: [{ title: 'Adobe to acquire Omniture for ~$1.8B (2009)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'ind_eloqua', type: 'entity', subtype: 'org', lane: 'Independents (absorbed)', title: 'Eloqua', start: '1999', end: '2012', precision: 'year', location: 'Vienna, Virginia', lat: 38.9, lng: -77.27, summary: 'The B2B marketing-automation pioneer that helped define lead scoring and nurture — acquired by Oracle in 2012, a marquee example of the pure-plays being absorbed into clouds.' },
  { op: 'add_node', ref: 'ind_exacttarget', type: 'entity', subtype: 'org', lane: 'Independents (absorbed)', title: 'ExactTarget', start: '2000', end: '2013', precision: 'year', location: 'Indianapolis, Indiana', lat: 39.77, lng: -86.16, summary: 'An email/cross-channel platform that bought Pardot, then was itself acquired by Salesforce in 2013 to become the Marketing Cloud.' },
  { op: 'add_node', ref: 'ind_marketo', type: 'entity', subtype: 'org', lane: 'Independents (absorbed)', title: 'Marketo', start: '2006', end: '2018', precision: 'year', location: 'San Mateo, California', lat: 37.56, lng: -122.32, summary: 'A marketing-automation leader that IPO\'d, went private under Vista, and was then acquired by Adobe in 2018 — the consolidation cycle in one company\'s life.' },
  // DATA & CDP
  { op: 'add_node', ref: 'org_segment', type: 'entity', subtype: 'org', lane: 'Data & CDP', title: 'Segment', start: '2012', precision: 'year', location: 'San Francisco, California', lat: 37.78, lng: -122.39, summary: 'Customer-data infrastructure that popularized the Customer Data Platform — a single pipe to collect and route first-party event data to every tool. Acquired by Twilio in 2020.' },
  { op: 'add_node', ref: 'd_twilio', type: 'event', lane: 'Data & CDP', title: 'Twilio acquires Segment', start: '2020-10', precision: 'month', location: 'San Francisco, California', lat: 37.78, lng: -122.39, summary: 'A ~$3.2B deal folding the leading CDP into a communications cloud — a signal that owning first-party customer data had become strategically central.', citations: [{ title: 'Twilio to acquire Segment for ~$3.2B (2020)', sourceType: 'press' }] },

  // ---- ENRICHMENT: more players + the AI-native frontier ----
  { op: 'add_node', ref: 'org_mailchimp', type: 'entity', subtype: 'org', lane: 'Mailchimp & email', title: 'Mailchimp', start: '2001', precision: 'year', location: 'Atlanta, Georgia', lat: 33.75, lng: -84.39, summary: 'Founded 2001 in Atlanta. Democratized email marketing for small businesses with a freemium model and a beloved brand — proof the SMB long tail was a market of its own.' },
  { op: 'add_node', ref: 'ev_mailchimp_intuit', type: 'event', lane: 'Mailchimp & email', title: 'Intuit acquires Mailchimp', start: '2021-09', precision: 'month', location: 'Atlanta, Georgia', lat: 33.75, lng: -84.39, summary: 'A ~$12B deal folding SMB email marketing into a small-business financial platform — the largest martech acquisition of its kind and a sign the SMB segment had come of age.', citations: [{ title: 'Intuit to acquire Mailchimp for ~$12B (2021)', sourceType: 'press' }] },
  { op: 'add_node', ref: 'org_klaviyo', type: 'entity', subtype: 'org', lane: 'Klaviyo & ecommerce', title: 'Klaviyo', start: '2012', precision: 'year', location: 'Boston, Massachusetts', lat: 42.36, lng: -71.06, summary: 'Founded 2012. Owned-data marketing (email + SMS) built for ecommerce, riding Shopify\'s rise. As first-party data gained value post-ATT, Klaviyo thrived — IPO\'d in 2023.' },
  { op: 'add_node', ref: 'org_tradedesk', type: 'entity', subtype: 'org', lane: 'The Trade Desk', title: 'The Trade Desk', start: '2009', precision: 'year', location: 'Ventura, California', lat: 34.27, lng: -119.23, summary: 'Founded 2009. The leading independent demand-side platform — the buy-side counterweight to the Google/Meta walled gardens — and a champion of cookie alternatives like UID2.' },
  { op: 'add_node', ref: 'org_mparticle', type: 'entity', subtype: 'org', lane: 'Data & CDP', title: 'mParticle', start: '2013', precision: 'year', location: 'New York, New York', lat: 40.71, lng: -74.01, summary: 'Founded 2013. A mobile-first Customer Data Platform; with Segment it defined the CDP category that the privacy era made essential infrastructure.' },
  { op: 'add_node', ref: 'ev_privacy_sandbox', type: 'event', lane: 'Industry & milestones', title: 'Google Privacy Sandbox (Topics API)', start: '2023', precision: 'year', location: 'Mountain View, California', lat: 37.42, lng: -122.08, summary: "Google ships the Topics API — an attempt to replace third-party cookies with privacy-preserving, on-device interest signals. A contested bid to redesign ad targeting for a post-cookie web." },
  { op: 'add_node', ref: 'concept_agentic', type: 'concept', title: 'Agentic Marketing', start: '2024', precision: 'year', geoScope: 'global', summary: 'Autonomous AI agents that plan and execute marketing tasks end-to-end — the leading edge after generative AI, operating on unified first-party data and reshaping the marketer\'s role from operator to director.' },

  // ---- EDGES (acquisitions = consolidation; causal throughlines) ----
  { op: 'add_edge', sourceId: 'org_adobe', targetId: 'ind_omniture', kind: 'acquired', label: '2009 · ~$1.8B → Adobe Analytics' },
  { op: 'add_edge', sourceId: 'org_adobe', targetId: 'ind_marketo', kind: 'acquired', label: '2018 · $4.75B' },
  { op: 'add_edge', sourceId: 'org_oracle', targetId: 'ind_eloqua', kind: 'acquired', label: '2012 · ~$871M' },
  { op: 'add_edge', sourceId: 'org_salesforce', targetId: 'ind_exacttarget', kind: 'acquired', label: '2013 · $2.5B → Marketing Cloud' },
  { op: 'add_edge', sourceId: 'brinker', targetId: 'ev_landscape2011', kind: 'caused', label: 'charts the landscape' },
  { op: 'add_edge', sourceId: 'org_hubspot', targetId: 'concept_inbound', kind: 'influenced', label: 'named the category' },
  { op: 'add_edge', sourceId: 'g_doubleclick', targetId: 'concept_programmatic', kind: 'influenced', label: 'scaled programmatic display' },
  { op: 'add_edge', sourceId: 'ev_gdpr', targetId: 'concept_cdp', kind: 'influenced', label: 'drove first-party data' },
  { op: 'add_edge', sourceId: 'ev_cookie_announce', targetId: 'concept_cdp', kind: 'influenced', label: 'post-cookie pivot' },
  { op: 'add_edge', sourceId: 'ev_att', targetId: 'concept_cdp', kind: 'influenced', label: 'first-party data scramble' },
  { op: 'add_edge', sourceId: 'ev_att', targetId: 'm_atthit', kind: 'caused', label: '~$10B revenue hit' },
  { op: 'add_edge', sourceId: 'ev_chatgpt', targetId: 's_einstein', kind: 'caused', label: 'AI arms race' },
  { op: 'add_edge', sourceId: 'ev_chatgpt', targetId: 'h_ai', kind: 'influenced' },
  // enrichment edges
  { op: 'add_edge', sourceId: 'org_tradedesk', targetId: 'org_google', kind: 'competed_with', label: 'independent DSP vs walled gardens' },
  { op: 'add_edge', sourceId: 'ev_chatgpt', targetId: 'concept_agentic', kind: 'influenced' },
  { op: 'add_edge', sourceId: 's_einstein', targetId: 'concept_agentic', kind: 'influenced', label: 'Agentforce' },
  { op: 'add_edge', sourceId: 'ev_cookie_announce', targetId: 'ev_privacy_sandbox', kind: 'caused', label: 'the cookie alternative' },
  { op: 'add_edge', sourceId: 'ev_att', targetId: 'org_klaviyo', kind: 'influenced', label: 'owned-data tailwind' },
]

const builder = new PatchBuilder(tl.id, loadGraph(tl.id))
const { results } = applyOps(builder, ops)
const patchId = commitPatch(tl.id, builder, 'Build the martech landscape — eras, players, consolidation, privacy, AI-native')
const idOf = (ref: string) => results.find((r: any) => r.ref === ref)?.id as string
console.log(`patch ${patchId}: ${results.filter((r: any) => r.id).length} ops applied`)

// --- the narrative story, anchored on Scott Brinker (the field's cartographer) ---
const cast = [
  { nodeId: idOf('brinker'), name: 'Scott Brinker', role: 'the cartographer' },
  { nodeId: idOf('org_google'), name: 'Google' },
  { nodeId: idOf('org_adobe'), name: 'Adobe' },
  { nodeId: idOf('org_salesforce'), name: 'Salesforce' },
  { nodeId: idOf('org_oracle'), name: 'Oracle' },
  { nodeId: idOf('org_meta'), name: 'Meta' },
  { nodeId: idOf('org_hubspot'), name: 'HubSpot' },
]
const beats: NewStorySegment[] = [
  { kind: 'narration', focusNodeId: idOf('brinker'), bodyText: "Marketing technology — 'martech' — is the fusion of marketing and software. Its story is best told through the man who mapped it: Scott Brinker, whose annual landscape watched the field swell from a curiosity into thousands of tools. But it begins three decades earlier, when data first started deciding who saw which message." },
  { kind: 'narration', focusNodeId: idOf('ev_banner'), settingNote: 'San Francisco, October 1994', bodyText: "October 1994. AT&T's banner appears on HotWired — the first paid web ad — and reportedly nearly half of those who saw it clicked. The click economy is born, and with it a radical premise: that every impression can be counted." },
  { kind: 'narration', focusNodeId: idOf('g_adwords'), bodyText: 'By 2000, Google AdWords turns demand into an auction: advertisers bid on keywords and pay for results. Search becomes the most accountable channel marketing has ever had, and performance marketing finds its engine — measurable, biddable, endlessly optimizable.' },
  { kind: 'narration', focusNodeId: idOf('org_hubspot'), bodyText: 'As ad inventory floods the web, HubSpot names the counter-move: inbound marketing. Earn attention with content people seek out rather than interrupt them. Being found — through search, social, and the new analytics — becomes a discipline of its own.' },
  { kind: 'narration', focusNodeId: idOf('ev_landscape2017'), bodyText: "Then, the explosion. From 2011 to 2017, Brinker's landscape runs from about 150 logos to over five thousand — the 'Martech 5000.' Marketing automation, social tools, analytics, and programmatic adtech multiply faster than any team can integrate them. Fragmentation becomes a way of life." },
  { kind: 'narration', focusNodeId: idOf('a_marketo'), bodyText: 'While the long tail sprawls, the top consolidates. Adobe, Salesforce, and Oracle assemble sprawling "marketing clouds" by swallowing the independent pioneers — Omniture, ExactTarget, Eloqua, Marketo. Point solutions become suites; the pure-plays become product lines.' },
  { kind: 'narration', focusNodeId: idOf('ev_att'), settingNote: 'The privacy reckoning, 2018–2021', bodyText: "Then the ground shifts. GDPR, then Apple's App Tracking Transparency, then Google's plan to kill the third-party cookie break the cross-site tracking the whole system ran on. ATT alone costs Meta roughly ten billion dollars a year. Targeting built on borrowed data suddenly looks fragile." },
  { kind: 'narration', focusNodeId: idOf('concept_cdp'), bodyText: 'The center of gravity moves to owned data. The Customer Data Platform — Segment, then Salesforce Data Cloud and Adobe\'s Real-Time CDP — becomes the new foundation: consented, first-party profiles a brand controls, instead of audiences it rents. The marketers who own their customer relationship win.' },
  { kind: 'narration', focusNodeId: idOf('ev_chatgpt'), settingNote: 'San Francisco, November 2022 — and after', bodyText: "Then ChatGPT, and martech turns AI-native: generative content, AI segmentation, copilots, and the first agentic systems — Salesforce's Agentforce among them. The direction is set: autonomous agents working on unified first-party data. The path stays messy — in 2024 Google reversed its cookie deprecation outright — but the arc is clear. Marketing went from buying attention, to measuring it, to automating it into clouds, to rebuilding on owned data, to handing the work to agents." },
]

const { storyId, segmentCount } = writeStory(
  idOf('brinker'),
  {
    title: 'The Story of Marketing Technology',
    hook: 'How marketing tech went from a single banner ad to autonomous agents — told through the man who mapped its explosion.',
    povType: 'omniscient',
    depthTier: 'deep',
    estimatedMinutes: 6,
    cast,
    slug: 'the-story-of-marketing-technology',
  },
  beats,
)
console.log(`story ${storyId}: ${segmentCount} beats on moment ${idOf('brinker')}`)

// Default view: collapse the long empty pre-1994 stretch; tune zoom for the 1994–2024 bulk.
setTimelineView(tl.id, owner.id, { pxPerDay: 0.5, collapseGaps: true })

// Publish so the story is shareable at /s/<slug> and viewable without login.
db.update(timelines).set({ isPublic: true }).where(eq(timelines.id, tl.id)).run()

console.log('\nDONE')
console.log(`  canvas: http://localhost:3001/timelines/${tl.id}`)
console.log(`  story:  http://localhost:3001/s/the-story-of-marketing-technology`)
