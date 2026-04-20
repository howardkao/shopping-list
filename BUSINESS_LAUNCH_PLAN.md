# Business & Tax Launch Plan for Provisions

## Phase 1: Immediate (Before Any Revenue)

### 1.1 Business Entity
- [ ] **Decide entity type:**
  - **Solo proprietorship (no filing required):** Simplest; report under your SSN; personal liability; max ~$150K revenue before complexity becomes painful
  - **Single-member LLC:** ~$100–$800 setup (varies by state); liability protection; can elect S-corp taxation; recommended if you anticipate >$150K year-1
  - **C-corp:** Overkill for launch; revisit if VC-funded later
  - **Recommendation:** File an LLC in Delaware or your home state; costs $150–300, eliminates personal liability, gives you room to scale
- [ ] **Get an EIN (Employer Identification Number):** Free; apply at irs.gov or by phone; instant online approval. Required for bank accounts, taxes, RevenueCat/Apple/Google hookups
- [ ] **Open a business bank account:** Use EIN + state filing docs; separate personal/business money from day one (required by law for LLCs; critical for tax audit defense). Avoid mixing
- [ ] **Decide jurisdiction:**
  - If US-based and interstate: Delaware LLC is standard (neutral tax, clean precedent, cheap annual fees ~$25)
  - If planning international expansion: consult a lawyer about EU VAT/GDPR registration later

### 1.2 Tax Registration & Obligations
- [ ] **Register for state income tax (if applicable):**
  - Some states (CA, NY, TX) require business registration
  - Check your state's Secretary of State or Department of Revenue site
  - Your tax advisor (below) can handle this
- [ ] **Seller's Permit / Sales Tax License (if you'll have US customers):**
  - **Apple/Google in-app purchases:** Apple and Google collect and remit sales tax on your behalf (you don't need to); they handle it
  - **Stripe/direct sales on web:** You're responsible; collect if required by state
  - **Provisions specifics:** Since you're doing in-app purchases on iOS/Android, Apple/Google handle it. Web Stripe? Check your state's nexus rules (do you have customers there?). For now, defer unless explicitly selling outside app stores
  - **Decision:** Leave as TBD pending actual sales; most revenue will flow through Apple/Google
- [ ] **Sales tax nexus rules:**
  - Economic nexus: if you exceed $100K revenue in a state, you must register and file. Apple/Google compliance handles this for in-app, but track it
  - Physical nexus: if you live/work in a state, you have nexus there (must file if any revenue)
  - **Provisions specifics:** You have physical nexus in your home state; economic nexus likely met if successful

### 1.3 Hire a Tax Advisor
- [ ] **Find a CPA or tax attorney specializing in:**
  - Software/SaaS startups (they know subscription tax treatment)
  - Multi-state/international expansion (you'll need this later)
  - Cost: $500–2K one-time consultation; $2K–10K/year ongoing
- [ ] **First appointment: establish structure + tax calendar**
  - Recommend LLC vs sole proprietor
  - Quarterly estimated tax timeline (critical; the IRS penalizes missing these)
  - State filing deadlines (often April 15 + mid-year deadlines)
  - What records to keep (covered below)
- [ ] **Ongoing: monthly/quarterly checkups**
  - Ensure accounting is tracking revenue + expenses correctly
  - Watch cash flow; quarterly taxes often surprise new business owners

---

## Phase 2: Pre-Launch (3–6 Months Before First Payment)

### 2.1 Revenue Tracking Infrastructure
- [ ] **Choose accounting software:**
  - **Wave (free):** Good for sole proprietors; invoicing, expense tracking, P&L reports
  - **QuickBooks Online (subscription):** Industry standard; integrates with banks; more powerful
  - **Xero:** Similar to QBO; cleaner UX for some
  - **For you:** Wave is probably fine; switch to QBO if revenues exceed $50K/year
- [ ] **Set up revenue feeds:**
  - **RevenueCat integration:** RevenueCat dashboard → CSV exports → accounting software. Automate monthly syncs or pull manually weekly
  - **Stripe (web sales):** Connect Stripe → Wave/QBO for automatic transaction import
  - **Apple/Google:** No direct feed; RevenueCat aggregates for you
  - **Manual tracking fallback:** Spreadsheet synced weekly from RevenueCat (name, date, amount, net after fees, currency, user id)
- [ ] **Track key metrics in a business ledger:**
  - Gross revenue (before platform fees: Apple/Google take 15–30%, RevenueCat ~5%)
  - Net revenue (what you actually receive)
  - Trial conversions (how many free trials → paid)
  - Customer acquisition cost (how much you spend to get a paying customer)
  - Churn rate (% of subscribers who cancel each month)
  - Example: 100 trials → 10 conversions (10%) → 5 churn after month 1 (50% churn) = 5 paying customers
- [ ] **VAT/GST if international:**
  - US-only: no action needed (Apple/Google handle state sales tax)
  - EU customers: need to register for VAT; apps in EU typically claim 0% VAT (service of goods to non-business) but rules vary by country. **Defer until first EU customer; consult tax advisor**
  - Canada: GST applies; Apple/Google handle collection
  - Australia/NZ: GST applies; same
  - **Decision:** Let Apple/Google handle tax compliance for now; revisit when/if you expand

### 2.2 Contract & Terms Review
- [ ] **Apple Developer Agreement:**
  - Sign before submitting to App Store; standard contract
  - Section 3.2 covers payment terms (net 30 days)
  - Mark renewal dates on your calendar
- [ ] **Google Play Billing Terms:**
  - Google Play Business and Program Policies
  - Subscription auto-renewal disclosures (legal requirement; Apple/Google enforce)
- [ ] **RevenueCat contract:**
  - Review their SLA and data retention policy
  - Confirm commission rate (free tier includes analytics; paid tiers add features)
- [ ] **Stripe Connect terms (if using Stripe for web sales):**
  - Standard contract; note payout schedule (default 2–3 days)
  - Fee schedule: 2.2% + $0.30 per transaction (standard US rates)
- [ ] **Privacy Policy + Terms of Service (already done, but needs lawyer review):**
  - Your draft in `src/LegalPages.jsx` covers product behavior
  - **Missing:** Your legal business name, contact email, jurisdiction/governing law
  - **To-do:** Have a lawyer review + finalize before public launch
  - **Cost:** $500–2K for a SaaS lawyer to review; many offer flat-fee app privacy reviews
  - **Timeline:** Do this 2–3 months before launch; gives you time to incorporate changes

### 2.3 IP & Trademark
- [ ] **Domain + social handles:**
  - [ ] Claim provisionsapp.com (register ASAP; ~$15/year)
  - [ ] Twitter/X, Instagram, TikTok: @provisionsapp (or _provisions, _app variant)
  - [ ] GitHub org or username (if you open-source later)
- [ ] **Trademark:**
  - **No action required for launch,** but flag this for year 2
  - "Provisions" is a common word; trademark is weak unless you have a distinctive logo/mark
  - **Decision:** Trademark if you plan long-term brand investment (cost: $500–3K via a lawyer; filing + 3–5 year process)
  - For now, rely on copyright (automatic on code/assets) and your brand story
- [ ] **Copyright on code + assets:**
  - Already owned (you wrote it); no registration needed
  - Add © notices to your app (footer, login, assets) for clarity
  - License choice already made (Elastic License 2.0 for source)

### 2.4 Insurance (Optional but Recommended)
- [ ] **General liability insurance:** ~$200–500/year; covers if a user sues you (e.g., claims the app ruined their shopping experience). Many indie devs skip this; if you do, accept the personal risk
- [ ] **Professional liability (E&O):** ~$500–2K/year; higher value; covers data breach or security incident
- [ ] **Cyber liability:** ~$1K–5K/year; covers if your servers are compromised. Only relevant if you hold sensitive data; Provisions does (Firebase with auth), so worth considering
- [ ] **Decision:** Skip for launch; revisit if you exceed $100K revenue or have any incident

---

## Phase 3: Subscription Mechanics & Financial Planning

### 3.1 RevenueCat Configuration
- [ ] **Subscription setup:**
  - Product ID: `com.provisionsapp.shoppinglist.premium.annual` (iOS) + Google Play equivalent
  - Price: $3.99/year (launch price; grandfather existing subscribers at this rate)
  - Renewal: automatic; users can disable in iOS Settings → Subscriptions
  - Trial: 2 months; free then auto-converts to paid (Apple + Google require clear disclosures)
  - Proration: if user cancels mid-month, do they get a refund? (RevenueCat handles; decide now)
- [ ] **RevenueCat dashboard:**
  - Entitlements: link to your app's read-only mode
  - Offerings: default vs future $9.99 tier (when you raise price)
  - Attribution: link to Firebase Analytics to see what campaigns drive subscribers
- [ ] **Payouts:**
  - RevenueCat aggregates Apple/Google; they pay you net of their fees
  - Apple: 15–30% fee depending on tier; payout ~30 days after month-end
  - Google: 15–30% fee; payout ~35 days after month-end
  - Example: $3.99 annual sale → Apple takes ~$0.60 (15%) → RevenueCat takes ~$0.20 (5%) → you get ~$3.19
  - Bank: Set up ACH direct deposit in RevenueCat console; connects to your business bank account

### 3.2 Financial Projections
- [ ] **Baseline scenario (conservative):**
  - Year 1: 500 new users, 10% trial→paid, 50% monthly churn → 25 active subscribers by year-end
  - Annual recurring revenue (ARR): 25 × $3.99 = ~$100/year (or ~$8/month)
  - Revenue net of platform fees: ~$60/year
  - This is "proof of concept" stage; focus on growth, not profit
  
- [ ] **Growth scenario (optimistic):**
  - Year 1: 10K users (via App Store featured + word-of-mouth), 15% conversion, 40% churn → 900 subscribers
  - ARR: 900 × $3.99 = ~$3,600; net ~$2,160
  - Still modest, but starting to cover server costs ($2-3K/month on Firebase Blaze)
  
- [ ] **Break-even:**
  - Firebase costs: ~$2–3K/month at scale (10k+ households)
  - Server/infrastructure: ~$500–1K/month (monitoring, backups, CDN)
  - Total annual: ~$30–50K
  - **Break-even revenue needed:** ~$40K ARR (assuming 60% after platform fees) = ~10K subscribers at $3.99
  - **Timeline:** 12–24 months if growth trajectory holds
  
- [ ] **Pricing strategy for growth:**
  - Launch at $3.99 to maximize downloads + network effects (more users → more valuable)
  - After 1 year or 5K subscribers: raise to $5.99 (or announce new tier at $9.99 for features)
  - Grandfather existing $3.99 subscribers; only new/churned users see higher price
  - Rationale: proven product + user base justifies price increase

### 3.3 Expense Tracking & Budgeting
- [ ] **Monthly expense categories:**
  - **Firebase (Blaze, variable):** Storage + downloads; budget $50–500/month depending on growth
  - **Apple Developer Program:** $99/year (~$8/month)
  - **Google Play Developer:** $25 one-time (~$0/month)
  - **RevenueCat (free tier covers launch; upgrade to "Pro" at $10K+ ARR):** ~$0–200/month
  - **Domain + email:** ~$20/year (~$2/month)
  - **Monitoring + error tracking (Sentry, Datadog):** ~$0–100/month
  - **VPN + security tools (optional):** ~$50–200/month
  - **Freelancers/contractors (design, QA, etc.):** variable
  - **Tax + accounting:** ~$2K–10K/year (~$200–800/month)
  - **Marketing (Facebook Ads, App Store Optimization):** $0–500/month (build organically first)
  
- [ ] **Baseline monthly expenses (lean):**
  - Firebase: $100
  - Apple/Google: $8
  - RevenueCat: $0
  - Domain: $2
  - Sentry: $29
  - Accounting: $200
  - **Total: ~$340/month = $4K/year**
  
  - **At 10K subscribers ($40K ARR, 60% net = $24K/year):**
    - Cash left after expenses: $20K/year
    - Enough to reinvest or take as salary/draw
    
  - **At 1K subscribers ($4K ARR, 60% net = $2.4K/year):**
    - Cash shortfall: -$1.6K (you subsidize from savings)
    - Expected until ~2K active subscribers

### 3.4 Tax & Profit Planning
- [ ] **Estimated quarterly taxes:**
  - IRS requires payment 4x/year if you expect > $1K profit
  - Deadline: April 15, June 15, Sept 15, Jan 15
  - Amount: roughly 25–30% of projected year-end profit (federal + state + self-employment tax ~15%)
  - **Example:** If you project $10K profit for the year, each quarter you pay ~$750
  - Underpayment penalties are steep; your tax advisor will calculate exact amounts
  
- [ ] **Deductions you can claim:**
  - **Home office:** If you dedicate a room, ~$150–300/month (square footage method)
  - **Tech expenses:** Laptop, monitor, phone (~$500–2K/year if new, amortized over 5 years)
  - **Software subscriptions:** Xero, Sentry, GitHub Pro, etc. (100% deductible)
  - **Professional services:** Tax advisor, lawyer, designer fees (100% deductible)
  - **Travel:** Conference attendance, client meetings (if applicable)
  - **Education:** Courses, books on software development, business (partially deductible)
  - **Meals + entertainment:** Limited (no longer fully deductible post-2017 tax law changes)
  - **Vehicle:** Mileage to business meetings (~$0.67/mile as of 2024)
  
- [ ] **Keeping records:**
  - **Critical:** Save receipts for all expenses in a folder (physical or digital)
  - **Accounting software:** Automatically categorizes transactions if connected to your bank
  - **Annual:** Export P&L from Wave/QBO; give to tax advisor by March 1st for April filing
  - **Retention:** Keep 7 years (IRS audit window is 3 years normally, 6 for underreporting >25%, 7 for fraud)

---

## Phase 4: Launch Checklist (1–2 Months Before)

### 4.1 App Store & Google Play Submission
- [ ] **Apple App Store:**
  - [ ] App privacy label (auto-filled from your privacy policy)
  - [ ] In-app purchase setup (Provisions Premium, $3.99/year, 2-month trial)
  - [ ] App screenshots (4–5 showing key features)
  - [ ] Description + keywords (for App Store search)
  - [ ] Category: Lifestyle (or Productivity if available)
  - [ ] Age rating: 4+ (no adult content)
  - [ ] Review cycle: 1–3 days for rejection, up to 2 weeks if Apple requests changes
  - Cost: $99/year developer program fee
  
- [ ] **Google Play:**
  - [ ] Same privacy label + in-app purchase setup
  - [ ] Screenshots + description + keywords
  - [ ] Content rating questionnaire
  - [ ] Review cycle: usually 2–4 hours
  - Cost: $25 one-time developer registration
  
- [ ] **Web (provisionsapp.com):**
  - [ ] Hosting: Firebase Hosting (already included in Blaze)
  - [ ] Domain: Register provisionsapp.com; point to Firebase
  - [ ] SSL/HTTPS: Automatic via Firebase
  - [ ] Marketing site: Link to App Store + Google Play download buttons; brief pitch + screenshots
  - [ ] Sign-up flow: Same as app (or email capture for waitlist pre-launch)

### 4.2 Legal & Compliance (Already In Progress)
- [ ] **Privacy Policy review by lawyer:**
  - [ ] Real operator name (your name or LLC name)
  - [ ] Contact email (support@provisionsapp.com)
  - [ ] Jurisdiction (e.g., "Laws of the state of California")
  - [ ] Data practices (GDPR compliance if you have EU users)
  - [ ] Third-party services disclosure (Firebase, RevenueCat, etc.)
  - [ ] CCPA compliance (if you have California users)
  - [ ] Timeline: Have lawyer review by Month -2; revise + finalize by Month -1
  
- [ ] **Terms of Service review:**
  - [ ] Limitation of liability clause
  - [ ] Subscription auto-renewal disclosures (required by Apple/Google)
  - [ ] Refund policy (Apple/Google handle refunds; your ToS should acknowledge this)
  - [ ] User conduct (no spam, no abuse, etc.)
  - [ ] Termination clause (you can remove users for ToS violations)
  
- [ ] **California Consumer Privacy Act (CCPA) compliance (if US-based):**
  - Only applies if you have California residents as customers
  - Obligations: disclose data practices, allow users to request/delete data
  - **Firebase + Provisions:** Users can request account deletion; your Privacy Policy should explain the process
  - Timeline: Implement by launch; compliance is ongoing

### 4.3 Email & Support
- [ ] **Support email setup:**
  - [ ] support@provisionsapp.com (use Google Workspace or Apple Mail forwarding to your email)
  - [ ] Response SLA: Aim for 24 hours (you're solo; users will understand)
  - [ ] FAQ doc: Common questions + answers (build incrementally from support emails)
  
- [ ] **Marketing emails:**
  - [ ] Welcome email for new subscribers
  - [ ] Churn prevention: Email at month 1.5 if they haven't paid yet (trial-ending reminder)
  - [ ] Re-engagement: 30 days after cancellation (offer to return, address feedback)
  - [ ] Tool: Mailchimp (free up to 500 contacts) or ConvertKit (if you add a blog)

### 4.4 Press & Launch Strategy
- [ ] **Soft launch (1–2 weeks before public):**
  - [ ] iOS + Google Play: Submit to review; don't announce publicly yet
  - [ ] Share with 10–20 friends/family for beta feedback
  - [ ] Collect testimonials + feature ideas
  
- [ ] **Public launch:**
  - [ ] Announce on Product Hunt (upvote drive for Day 1)
  - [ ] Tweet thread on launch day (your Twitter + friends retweet)
  - [ ] Email existing users (from your private GitHub/landing page) if you have an audience
  - [ ] Reddit: r/productivity, r/ios, r/androidapps (genuine posts, not ads)
  - [ ] Press: Pitch to tech journalists if notable (unlikely for first app; skip for now)
  
- [ ] **Post-launch marketing (first 3 months):**
  - [ ] App Store Optimization (ASO): Tweak keywords, screenshots, description based on early downloads
  - [ ] User feedback: Read reviews, respond positively; fix negative feedback ASAP
  - [ ] Referral program (optional): "Share a 2-month trial code with a friend" (RevenueCat supports this)

---

## Phase 5: Ongoing (Year 1+)

### 5.1 Accounting & Tax Filings
- [ ] **Monthly (1st business day of month):**
  - [ ] Export revenue from RevenueCat
  - [ ] Reconcile to accounting software (Wave or QBO)
  - [ ] Review P&L; flag unusual transactions
  
- [ ] **Quarterly (15 days after quarter-end):**
  - [ ] Calculate estimated tax payment (your tax advisor will guide)
  - [ ] Pay via IRS Direct Pay or EFTPS
  - [ ] File Form 1040-ES (if solo proprietor) or equivalent (if LLC)
  
- [ ] **Annual (by March 1):**
  - [ ] Export full P&L + balance sheet from accounting software
  - [ ] Provide to tax advisor for tax return preparation
  - [ ] File Schedule C (sole proprietor) or Form 1065 (LLC taxed as partnership) + Form 1040 by April 15
  - [ ] If estimated taxes were under/over, settle on tax day
  - [ ] Save final tax return + receipts; file cabinet or digital archive

### 5.2 Growth & Business Development
- [ ] **At $10K ARR (1–2K subscribers):**
  - [ ] Consider hiring a developer (contract or full-time) to double velocity
  - [ ] Consider freelance designer for app icon refresh / marketing site
  - [ ] Plan feature roadmap for year 2 (based on user feedback)
  
- [ ] **At $50K ARR (10K+ subscribers):**
  - [ ] Consider S-corp election (save ~15% on self-employment tax if net profit > $60K)
  - [ ] Hire full-time developer
  - [ ] Set up customer support Zendesk or Intercom
  - [ ] Plan Series A fundraising (if you want to scale aggressively)
  
- [ ] **International expansion:**
  - [ ] EU VAT registration (required when revenue hits threshold; ~€100K/year varies by country)
  - [ ] GDPR compliance audit (likely already good; your lawyer will confirm)
  - [ ] Japan + South Korea: Consider localization (language, currency, payment methods)

### 5.3 Annual Financial Reviews
- [ ] **Quarterly business review (end of each quarter):**
  - [ ] Revenue/subscriber trends (is growth accelerating or declining?)
  - [ ] Customer acquisition cost (how much did marketing spend per subscriber?)
  - [ ] Lifetime value (how much does an average subscriber generate over time?)
  - [ ] Churn analysis (why are people canceling? Can you address it with a feature?)
  - [ ] Unit economics (is your cost to serve < revenue per user?)
  
- [ ] **Annual strategic review (Jan or post-launch + 1 year):**
  - [ ] Profitability path: Are you on track to break even by Year 2?
  - [ ] Team plan: Can you scale with your current bandwidth?
  - [ ] Funding: Do you need investor capital, or are you bootstrapping to profitability?
  - [ ] Price changes: Is $3.99 still the right price? (data-driven decision)

---

## Summary Timeline

| Phase | Timeframe | Owner | Cost |
|-------|-----------|-------|------|
| **Entity + Tax Setup** | Now–2 weeks | You + CPA | $500–2K |
| **Accounting + Contracts** | 2 weeks–1 month | You + CPA | $1K–5K (legal review of ToS) |
| **Revenue Setup** | 1–2 months | You + RevenueCat | $0–500 |
| **App Store Submission** | 2–3 months | You | $124 (both app stores) |
| **Legal Final Review** | 2–3 months | Lawyer | $500–2K |
| **Public Launch** | 3 months | You | $0 (launch costs via stores) |
| **Year 1 Operations** | Ongoing | You + CPA | $10K–20K (accounting + taxes) |

---

## Key Decisions You Need To Make Now

1. **Entity type:** LLC (recommended) or sole proprietor?
   - Recommendation: **LLC in Delaware** (~$300 setup, $25/year maintenance)

2. **Tax advisor:** Who? Get a SaaS-focused CPA or tax attorney.
   - Timeline: Book by end of April 2026 (while tax returns are still fresh in everyone's minds)

3. **Accounting software:** Wave (free) or QuickBooks Online ($20–100/month)?
   - Recommendation: **Wave** for first year; switch to QBO at $10K+ ARR

4. **Support email:** support@provisionsapp.com or your personal email?
   - Recommendation: **New email** (easier to delegate later; cleaner records)

5. **Marketing spend:** Bootstrap organic (free) or paid campaigns ($200–500/month)?
   - Recommendation: **Organic first** (Product Hunt, Reddit, Twitter); revisit paid after Month 6 if traction is slow

---

## Notes

- **Legal/tax advice disclaimer:** This plan is a checklist, not legal/tax counsel. Your situation may differ (state, income level, corporate structure, international elements). Consult a licensed tax advisor and lawyer before filing anything.
- **Scope creep:** Don't hire anyone or spend money on marketing until you validate that the product has product-market fit (strong early user reviews + word-of-mouth growth).
- **Profitability is optional:** Many successful indie apps run at a loss initially to grow the user base. Provisions' unit economics are favorable ($3.99 subscription = low CAC needed to break even); focus on growth Year 1, profit Year 2+.
