/**
 * Privacy Policy and Terms of Service for the Provisions web app.
 * "Operator" means whoever runs this deployment (hosted provider or self-hoster).
 *
 * ---------------------------------------------------------------------------
 * PRE-PUBLIC LAUNCH (tracked in PRODUCTIZATION.md → Must-Have checklist):
 * Counsel must review this file; add operator legal name, contact email,
 * governing law/venue; confirm all claims match production Firebase config,
 * log retention, admin log access, Analytics on/off, and deletion behavior.
 * ---------------------------------------------------------------------------
 */

function LegalShell({ title, effectiveLabel, onBack, children }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F7F7F7' }}>
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-sm font-semibold text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{title}</h1>
        <p className="text-sm text-gray-500 mb-8">{effectiveLabel}</p>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-sm text-gray-700 leading-relaxed space-y-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="text-base font-bold text-gray-900 pt-1">{children}</h2>;
}

export function PrivacyPolicyPage({ onBack }) {
  return (
    <LegalShell
      title="Privacy Policy"
      effectiveLabel="Effective: April 17, 2026"
      onBack={onBack}
    >
      <p>
        This policy describes how information is collected, used, and shared when you use the{' '}
        <strong>Provisions</strong> application on this website or installed as a web app
        (the &quot;Service&quot;). The <strong>operator</strong> of the Service is the person or
        organization that controls the Firebase project and hosting used by this instance (for
        example, a household self-hosting the app, or a company providing a hosted version).
      </p>

      <SectionTitle>Information we collect</SectionTitle>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Account information.</strong> When you sign up or sign in, we process your email
          address, a display name you provide, and credentials managed by{' '}
          <a
            href="https://firebase.google.com/support/privacy"
            className="font-semibold underline decoration-gray-300 hover:decoration-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Firebase Authentication
          </a>
          . Passwords are stored and handled by Firebase; the operator does not receive your
          password in plain text.
        </li>
        <li>
          <strong>Household and list data.</strong> Shopping list items, purchase-related events,
          item suggestions and taxonomy (aisles, categories, pinned shortcut items, library), invite codes,
          optional notes, and similar content you or your household save in the Service are stored
          in{' '}
          <a
            href="https://firebase.google.com/support/privacy"
            className="font-semibold underline decoration-gray-300 hover:decoration-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Firebase Realtime Database
          </a>{' '}
          under your household&apos;s records. Other members of the same household can see this
          data according to the product&apos;s sharing model.
        </li>
        <li>
          <strong>Technical and operational logs.</strong> The app may send diagnostic and
          operational log entries (for example sign-in attempts, errors, and coarse usage events) to
          Firebase for the operator to troubleshoot and improve reliability. Logs are retained for a
          limited period (on the order of weeks) and are readable by household administrators where
          the product exposes that capability.
        </li>
        <li>
          <strong>Local storage on your device.</strong> To work offline, the Service uses your
          browser&apos;s <strong>IndexedDB</strong> and similar storage to cache list data,
          authentication state, and queued log entries. This data stays on your device until cleared
          by the app, the browser, or you.
        </li>
        <li>
          <strong>Optional analytics.</strong> If the operator configures Google Analytics for
          Firebase (measurement ID), Google may collect usage and device information according to
          Google&apos;s policies. If no measurement ID is configured, this collection is not
          enabled by this codebase path.
        </li>
      </ul>

      <SectionTitle>How we use information</SectionTitle>
      <p>We use the information above to provide, secure, and improve the Service, including:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>authenticating you and keeping you signed in across sessions;</li>
        <li>synchronizing your household&apos;s shopping data in real time;</li>
        <li>generating suggestions and history features from data you choose to keep;</li>
        <li>detecting abuse, diagnosing outages, and supporting account recovery flows.</li>
      </ul>

      <SectionTitle>Sharing</SectionTitle>
      <p>
        We do not sell your personal information. Data is processed by service providers needed to
        run the Service (notably Google Firebase / Google Cloud). Their processing is governed by
        their terms and privacy documentation. Household members you invite can see household data
        as designed by the app.
      </p>

      <SectionTitle>Retention and deletion</SectionTitle>
      <p>
        Data is kept for as long as your account and household records exist. You may be able to
        delete your account from within the app where the operator has enabled that feature;
        deletion removes or disconnects your user profile as implemented by the operator&apos;s
        Firebase rules and cleanup procedures. Operational logs may persist for a short retention
        window independent of the shopping list.
      </p>

      <SectionTitle>Security</SectionTitle>
      <p>
        We rely on industry-standard transport encryption (HTTPS) and Firebase security rules to
        restrict access to household data. No method of transmission or storage is perfectly secure;
        use a strong, unique password and protect devices that stay signed in.
      </p>

      <SectionTitle>Children</SectionTitle>
      <p>
        The Service is not directed at children under 13 (or the minimum age required in your
        jurisdiction). Do not create an account for a child below that age.
      </p>

      <SectionTitle>International users</SectionTitle>
      <p>
        Firebase and related infrastructure may process data in the United States and other
        countries where Google operates. By using the Service, you understand that your information
        may be transferred to those locations.
      </p>

      <SectionTitle>Changes to this policy</SectionTitle>
      <p>
        The operator may update this policy from time to time. Material changes should be reflected
        by updating the effective date and, where appropriate, notice in the app.
      </p>

      <SectionTitle>Contact</SectionTitle>
      <p>
        For privacy questions about <em>this</em> deployment, contact the operator of the site you
        are using (for self-hosted instances, that is typically the household or organization that
        invited you).
      </p>
    </LegalShell>
  );
}

export function TermsOfServicePage({ onBack }) {
  return (
    <LegalShell
      title="Terms of Service"
      effectiveLabel="Effective: April 17, 2026"
      onBack={onBack}
    >
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the{' '}
        <strong>Provisions</strong> web application (the &quot;Service&quot;). By creating an
        account, signing in, or otherwise using the Service, you agree to these Terms. If you do
        not agree, do not use the Service.
      </p>

      <SectionTitle>The operator</SectionTitle>
      <p>
        The <strong>operator</strong> is the person or entity that provides this instance of the
        Service (for example by deploying the software and owning the Firebase project). If you use
        someone else&apos;s deployment, your agreement is with that operator; open-source or
        portfolio use of the underlying code does not by itself create a contract with the authors
        of the repository.
      </p>

      <SectionTitle>Eligibility and accounts</SectionTitle>
      <p>
        You must be old enough to form a binding contract in your jurisdiction. You are
        responsible for the accuracy of information you provide and for maintaining the
        confidentiality of your password and device access. Notify your operator if you believe
        your account has been compromised.
      </p>

      <SectionTitle>Household access</SectionTitle>
      <p>
        Features may allow multiple people to share a single household list. You are responsible for
        whom you invite and for content added under your account. The operator is not obligated to
        mediate disputes between household members.
      </p>

      <SectionTitle>Acceptable use</SectionTitle>
      <p>You agree not to:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>use the Service in violation of law or the rights of others;</li>
        <li>attempt to gain unauthorized access to data, accounts, or systems;</li>
        <li>probe, scrape, or stress-test the Service in a way that could harm availability;</li>
        <li>upload malware or content designed to disrupt the Service;</li>
        <li>misuse invitation codes, logging, or admin features to harass or spy on others.</li>
      </ul>
      <p>The operator may suspend or terminate access for violations.</p>

      <SectionTitle>Content</SectionTitle>
      <p>
        You retain rights to content you submit. You grant the operator and the Service the license
        they need to store, process, synchronize, and display that content for you and your
        household, and to operate backups and security controls as configured.
      </p>

      <SectionTitle>Third-party services</SectionTitle>
      <p>
        The Service depends on third parties (such as Google Firebase). Their availability,
        features, and terms may change. The operator is not responsible for third-party failures
        outside its reasonable control.
      </p>

      <SectionTitle>Disclaimer of warranties</SectionTitle>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES
        OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE FULLEST EXTENT PERMITTED BY
        LAW.
      </p>

      <SectionTitle>Limitation of liability</SectionTitle>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, THE OPERATOR AND ITS SUPPLIERS WILL NOT BE LIABLE FOR
        ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
        PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. THE AGGREGATE LIABILITY OF
        THE OPERATOR FOR CLAIMS RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE
        AMOUNTS YOU PAID THE OPERATOR FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B)
        FIFTY U.S. DOLLARS (US $50), IF YOU DID NOT PAY ANYTHING, (B) ALONE APPLIES.
      </p>

      <SectionTitle>Indemnity</SectionTitle>
      <p>
        You will defend and indemnify the operator and its affiliates against any claims, damages,
        losses, and expenses (including reasonable attorneys&apos; fees) arising from your misuse of
        the Service or violation of these Terms.
      </p>

      <SectionTitle>Changes</SectionTitle>
      <p>
        The operator may modify the Service or these Terms. Continued use after changes become
        effective constitutes acceptance of the revised Terms where permitted by law.
      </p>

      <SectionTitle>Governing law</SectionTitle>
      <p>
        These Terms are governed by the laws applicable in the place where the operator is
        established, excluding conflict-of-law rules that would apply another jurisdiction&apos;s
        law, unless mandatory consumer protections in your country say otherwise.
      </p>

      <SectionTitle>Severability</SectionTitle>
      <p>
        If any provision is held unenforceable, the remaining provisions remain in effect to the
        maximum extent permitted.
      </p>
    </LegalShell>
  );
}
