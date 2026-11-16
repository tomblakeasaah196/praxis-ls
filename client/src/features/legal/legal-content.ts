/**
 * The text of the two public legal pages, `/privacy` and `/terms`.
 *
 * ── WHY THESE PAGES EXIST ───────────────────────────────────────────────────
 *
 * Google will not let the "Praxis LS Mail" OAuth app leave Testing until its
 * consent screen links to a public privacy policy and terms of service on the
 * authorised domain, and its verification review reads the privacy policy for
 * one thing in particular: how Google user data (Gmail) is accessed, used,
 * stored and shared, plus the Limited Use statement. Until these existed every
 * path on praxisls.com fell through to the staff sign-in, so there was nothing
 * to link to.
 *
 * ── WHY THE TEXT IS DATA, IN ENGLISH, AND NOT tr() ──────────────────────────
 *
 * A legal text is one authoritative document, not a set of UI labels. Running
 * each paragraph through the label dictionary would produce a page whose
 * French half is whatever subset happens to have been translated — a mixed
 * document nobody signed off. The English text is the binding version; a
 * French translation, when there is one, is a second document reviewed as a
 * whole and added here as its own entry.
 *
 * ── CHANGING IT ─────────────────────────────────────────────────────────────
 *
 * Bump `updated` on every change that alters meaning. The Gmail section and
 * the Limited Use sentence are what Google's reviewers check against the app's
 * real behaviour: if the mail engine starts doing something new with Gmail
 * data, this text has to say so BEFORE that ships, not after.
 */

/** A paragraph, or a list when the value is an array. */
export type LegalBlock = string | string[];

export type LegalSection = {
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDoc = {
  title: string;
  /** Plain text, day-first — never a Date run through a locale formatter. */
  updated: string;
  intro: LegalBlock[];
  sections: LegalSection[];
};

export const COMPANY = {
  name: "JBS PRAXIS LIMITED",
  rc: "RC 9985884",
  registeredIn: "Nigeria",
  lagos: "21B Bode Ajakaiye Street, Lekki, Lagos, Nigeria",
  douala: "1030 Avenue Douala Manga Bell, Bali, Douala, Cameroon",
  email: "support@praxisls.com",
} as const;

const UPDATED = "16 November 2026";

export const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  updated: UPDATED,
  intro: [
    `This policy explains how ${COMPANY.name} ("JBS Praxis", "we", "us") handles personal data in Praxis LS, our business software for logistics, operations and OHADA accounting, and on the Praxis LS websites. It also explains, in its own section, exactly what we do with data from Google accounts, including Gmail, when you connect one.`,
  ],
  sections: [
    {
      heading: "1. Who We Are",
      blocks: [
        `${COMPANY.name} is a company registered in ${COMPANY.registeredIn} (${COMPANY.rc}). Our office in Nigeria is at ${COMPANY.lagos}, and in Cameroon at ${COMPANY.douala}.`,
        `For any question about this policy or your data, write to ${COMPANY.email}.`,
      ],
    },
    {
      heading: "2. Our Role",
      blocks: [
        "Praxis LS is used by companies (our \"customers\") for their own business. When a customer or its staff put information into Praxis LS (shipments, clients, invoices, documents, emails), the customer decides what that information is for. For that data the customer is the controller and we act as its processor: we handle it only to provide the service, on the customer's instructions.",
        "For the account details we need to run the service, for our own websites, and for our relationship with customers, we are the controller.",
        "If you use Praxis LS through your employer, your employer's administrator manages your account and can also help with requests about your data.",
      ],
    },
    {
      heading: "3. What We Collect",
      blocks: [
        [
          "Account details: your name, work email address, phone number, role and sign-in records.",
          "Business data that you or your organisation enter or upload into Praxis LS.",
          "Mailbox data, if you connect a mailbox: your email address, the messages, attachments, folders or labels, and the access tokens needed to keep the connection working. Section 4 covers Google accounts in detail.",
          "Technical data: IP address, browser and device type, and logs of requests and errors, which we use to keep the service secure and working.",
          "Support messages you send us.",
        ],
        "We use only the cookies and browser storage needed to sign you in, keep you signed in, and remember settings such as language and theme. We do not use advertising or cross-site tracking cookies.",
      ],
    },
    {
      heading: "4. Google User Data (Gmail)",
      blocks: [
        "You can choose to connect a Google account (Gmail or Google Workspace) to Praxis LS so you can read, send and file your work email inside the application. This section describes everything we do with the data Google gives us when you do.",
        "What we access. When you connect, Google asks you to approve the following, and we receive only what you approve:",
        [
          "Your email address and basic Google account identifier (the \"openid\" and \"email\" permissions), to know which mailbox was connected and to show it to you.",
          "Read, compose, send and organise your Gmail messages (the \"gmail.modify\" permission). We do not request permission to permanently delete your email.",
        ],
        "How we use it. Only to provide the features you see and use in Praxis LS:",
        [
          "showing your mailbox, messages, attachments and labels inside Praxis LS, and keeping them in step with Gmail;",
          "sending emails and replies that you write or approve, from your own address;",
          "applying the actions you take, such as marking read, moving, labelling or archiving;",
          "linking messages to the records you choose (a shipment, a client, an invoice) and finding them again by search;",
          "AI features you choose to use on a message, such as a summary or a suggested reply.",
        ],
        "How we store it. Access tokens are encrypted before they are stored. Copies of messages are kept in your organisation's own workspace on secure cloud servers, protected by access controls and encrypted in transit.",
        "How we share it. We do not sell Google user data and we never use it for advertising. We do not transfer it to anyone except: (a) service providers that host or run Praxis LS for us, under contract and only to provide the features above; (b) where the law requires it; (c) as part of a merger or sale of the business, under the same protections; or (d) with your explicit consent.",
        "No training of AI models. Google user data is never used to develop, improve or train generalised AI or machine-learning models. When you use an AI feature on a message, the content is sent to an AI service only to produce the result you asked for, and only to providers that do not use it to train their models.",
        "People. Our staff do not read your email, except where you ask us to (for example in a support case), where it is needed for security such as investigating abuse, or where the law requires it.",
        "Disconnecting and deletion. You can disconnect a Google mailbox in Praxis LS at any time, which stops all further access. You can also remove Praxis LS's access from your Google account at https://myaccount.google.com/permissions. To have the email data we hold deleted, ask your organisation's administrator or write to us; we delete it within 30 days unless the law requires us to keep it.",
        "Limited Use. Praxis LS's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
        "The same rules apply when you connect a Microsoft 365 mailbox or a mailbox on your own mail server.",
      ],
    },
    {
      heading: "5. How We Use Personal Data",
      blocks: [
        [
          "to provide, maintain and support Praxis LS for our customers;",
          "to keep accounts and data secure, and to detect and prevent fraud and abuse;",
          "to send service messages, such as sign-in codes, security alerts and notices about changes;",
          "to meet our legal, tax and accounting obligations.",
        ],
        "We rely on the performance of our contract with customers, our legitimate interest in running a secure and reliable service, our legal obligations and, where the law requires it, your consent.",
      ],
    },
    {
      heading: "6. Who We Share Data With",
      blocks: [
        [
          "people in your own organisation who are authorised to see it in Praxis LS;",
          "service providers that help us run the service (hosting, email delivery, messaging and AI services), bound by contract to use the data only for that purpose;",
          "authorities, where the law requires us to;",
          "a buyer or successor, if our business is merged or sold, under the same protections.",
        ],
        "We do not sell personal data.",
      ],
    },
    {
      heading: "7. Where Data Is Kept",
      blocks: [
        "Praxis LS runs on secure cloud servers. Some of our service providers may process data outside Nigeria or Cameroon. Where that happens we use the safeguards the applicable data protection laws require.",
      ],
    },
    {
      heading: "8. Security",
      blocks: [
        "We encrypt data in transit, encrypt stored passwords and access tokens, limit access by role, keep audit records of sensitive actions, and back up data regularly. No system is perfectly secure; if a breach affects your personal data, we will notify you and the authorities as the law requires.",
      ],
    },
    {
      heading: "9. How Long We Keep It",
      blocks: [
        "We keep customer data for as long as the customer's subscription is active, and then delete or return it as agreed with the customer, except where the law requires us to keep records for longer (for example accounting records). Logs are kept for a limited period for security purposes.",
      ],
    },
    {
      heading: "10. Your Rights",
      blocks: [
        "Depending on where you are, you may ask to access, correct or delete your personal data, to object to or restrict how it is used, to receive a copy in a portable format, and to withdraw consent you have given. Write to us at the address below, or ask your organisation's administrator. We answer within the time the law sets.",
        "The laws that mainly apply to us are Nigeria's Data Protection Act 2023 and Cameroon's Law No. 2024/017 of 23 December 2024 on personal data protection. You may complain to the Nigeria Data Protection Commission (https://ndpc.gov.ng) or to the personal data protection authority in Cameroon.",
      ],
    },
    {
      heading: "11. Children",
      blocks: [
        "Praxis LS is a business service and is not meant for anyone under 18.",
      ],
    },
    {
      heading: "12. Changes to This Policy",
      blocks: [
        "We will update this page when our practices change and show the new date at the top. If a change is significant, we will tell customers before it takes effect.",
      ],
    },
    {
      heading: "13. Contact Us",
      blocks: [
        `${COMPANY.name}, ${COMPANY.lagos}. Email: ${COMPANY.email}.`,
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: "Terms of Service",
  updated: UPDATED,
  intro: [
    `These terms govern the use of Praxis LS, provided by ${COMPANY.name} ("JBS Praxis", "we", "us"). By using Praxis LS you agree to them. If you use it on behalf of an organisation, you confirm you may accept these terms for that organisation, and "you" includes it. Where your organisation has signed a separate agreement with us, that agreement takes priority over these terms.`,
  ],
  sections: [
    {
      heading: "1. The Service",
      blocks: [
        "Praxis LS is online business software for logistics, operations, document management, communications and OHADA accounting. We may improve and change the service over time; we will not remove a core function you pay for without telling you in advance.",
      ],
    },
    {
      heading: "2. Accounts",
      blocks: [
        "Your organisation's administrator creates and manages user accounts. Keep your sign-in details private and tell us or your administrator straight away if you think someone else has used your account. You are responsible for what happens under your account.",
      ],
    },
    {
      heading: "3. Acceptable Use",
      blocks: [
        "You must not:",
        [
          "break the law, or use the service to send spam, fraud or harmful content;",
          "try to access accounts, data or systems you are not authorised to;",
          "interfere with, overload, probe or reverse-engineer the service, except where the law allows it;",
          "resell or provide the service to others without our written agreement.",
        ],
      ],
    },
    {
      heading: "4. Your Data",
      blocks: [
        "Your organisation owns the data it puts into Praxis LS. You give us permission to host, process and display it only as needed to provide and support the service. Our Privacy Policy explains how we handle personal data.",
        "You are responsible for having the right to put the data into Praxis LS and for its accuracy.",
      ],
    },
    {
      heading: "5. Connected Services",
      blocks: [
        "You can connect outside services, such as a Google (Gmail) or Microsoft 365 mailbox or your own mail server. By connecting one, you authorise Praxis LS to access it as described when you connect and in our Privacy Policy. Your use of those services stays subject to their own terms. You can disconnect at any time. We are not responsible for outages or changes on the provider's side.",
      ],
    },
    {
      heading: "6. AI Features",
      blocks: [
        "Some features use artificial intelligence to draft, summarise or suggest. Their results can be wrong. Check them before relying on them, especially for accounting, tax, customs or legal matters, where the decision stays yours.",
      ],
    },
    {
      heading: "7. Fees",
      blocks: [
        "Fees, billing periods and payment terms are those in your order form, quotation or subscription. Fees do not include taxes unless stated. If an invoice remains unpaid after a reminder, we may suspend the service until it is paid.",
      ],
    },
    {
      heading: "8. Availability and Support",
      blocks: [
        "We work to keep Praxis LS available and secure, and we schedule maintenance to limit disruption. We cannot promise the service will never be interrupted or error-free. Support is available at the contact below.",
      ],
    },
    {
      heading: "9. Intellectual Property",
      blocks: [
        "Praxis LS, its software, design and documentation belong to JBS Praxis and its licensors. These terms give you the right to use the service while your subscription is active; they do not transfer any ownership to you.",
      ],
    },
    {
      heading: "10. Confidentiality",
      blocks: [
        "Each of us will keep the other's non-public information confidential and use it only for the purpose of these terms, except where the law requires disclosure.",
      ],
    },
    {
      heading: "11. Suspension and Termination",
      blocks: [
        "Either party may end the service as set out in the order form or subscription. We may suspend access to protect the service or other customers, or for a serious breach of these terms, and will tell you why. When the service ends, you may export your data for 30 days, after which we delete it, except where the law requires us to keep it.",
      ],
    },
    {
      heading: "12. Disclaimers",
      blocks: [
        "Apart from what these terms expressly say, the service is provided \"as is\", and we exclude other warranties to the extent the law allows.",
      ],
    },
    {
      heading: "13. Limitation of Liability",
      blocks: [
        "To the extent the law allows, neither party is liable for indirect or consequential losses, or for loss of profit, revenue or data, and each party's total liability under these terms is limited to the fees paid for the service in the 12 months before the claim. Nothing here limits liability that cannot be limited by law, such as for fraud.",
      ],
    },
    {
      heading: "14. Governing Law and Disputes",
      blocks: [
        "These terms are governed by the laws of the Federal Republic of Nigeria. We will first try to settle any dispute in good faith; if that fails, the courts of Lagos State, Nigeria have jurisdiction.",
      ],
    },
    {
      heading: "15. Changes to These Terms",
      blocks: [
        "We may update these terms and will show the new date at the top. If a change is significant, we will tell customers before it takes effect. Continuing to use the service after that means you accept the change.",
      ],
    },
    {
      heading: "16. Contact Us",
      blocks: [
        `${COMPANY.name} (${COMPANY.rc}), ${COMPANY.lagos}. Email: ${COMPANY.email}.`,
      ],
    },
  ],
};
