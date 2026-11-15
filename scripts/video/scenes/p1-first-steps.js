"use strict";
/**
 * Praxis LS, part 1 of the introduction: Premiers pas (First Steps).
 *
 * The narration is French and the application stays in English on purpose: every button, tab and
 * menu a viewer must find is said in English (between « and »), exactly as the screen reads it, and
 * the subtitle under the picture is the English translation of the French line. The video follows
 * Nadège Tchouameni, a new Operations Manager at Smart LS (invented, like every person on screen),
 * from the invitation in her inbox to her first sign-out; Serge Ndzana, the Finance Manager, shows
 * the phone. About eight minutes.
 *
 * Decided with JBS Praxis, 15/11/2026 (eight questions asked first): French narration (Kokoro
 * ff_siwis) with English subtitles; filmed on a throwaway copy with invented staff; the real Smart LS
 * branding; TEST described as it is, a practice copy that never touches LIVE and that Praxis LS can
 * reset; two parts, this one first (the safer sign-in chapters, Quick PIN, passkeys, the lock screen
 * and two-step codes, are part 2).
 *
 * A line is { fr, en, do? }: `fr` is spoken (and is the French transcript), `en` is the subtitle,
 * `do` is what a hand does as the line starts. "|" only splits a long subtitle in two.
 */
const ground = require("../ground");
const { heading, dialog, soft, tour, mailPage } = require("../helpers");

const EMAIL = "nadege.tchouameni@smartls.test";
/** A tab of the ribbon's second row (a tab or a link, by its name). */
const sub = (s, name) => {
  const n = new RegExp(`^${name}$`, "i");
  return s.page.getByRole("tab", { name: n }).or(s.page.getByRole("link", { name: n })).first();
};
const SERGE = "serge.ndzana@smartls.test";

module.exports = {
  id: "p1-first-steps",
  file: "Praxis-LS-01-Premiers-Pas-FR-EN",
  meta: { title: "Praxis LS · Premiers pas / First steps (Part 1)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Formation Praxis LS · Partie 1",
    title: "Premiers pas",
    subtitle: "Connexion et visite de votre espace de travail",
    english: "Getting started: signing in and a tour of your workspace",
    left: "Une visite guidée en français, sous-titrée en anglais",
  },
  closing: {
    eyebrow: "Formation Praxis LS · Partie 1",
    title: "Merci",
    subtitle: "À bientôt pour la partie 2 : se connecter en toute sécurité",
    english: "Thank you. See you in part 2: safer sign-in",
    left: "smartls.praxisls.com",
  },

  /** The ground: branding, company, cast, the TEST sample data, and a fresh invitation for Nadège. */
  async prepare({ log, out }) {
    await ground.applyBranding(log);
    await ground.ensureCast({ invite: ["nadege"], log });
    await ground.ensureSandboxData(log);
    await ground.invite("nadege", out, { reset: true });
    log("ground ready");
  },

  chapters: [
    {
      name: "Bienvenue",
      en: "Welcome",
      shots: [{
        kind: "card", card: "opening",
        lines: [
          { fr: "Bienvenue chez «Smart LS». Cette vidéo vous présente votre nouvel espace de travail, «Praxis LS».",
            en: "Welcome to Smart LS. This video introduces your new workspace, Praxis LS." },
          { fr: "Vous allez voir comment recevoir votre invitation, vous connecter, puis vous repérer sur ordinateur et sur téléphone.",
            en: "You will see how to receive your invitation, sign in, then find your way around on a computer and a phone." },
          { fr: "Un mot sur la langue. La vidéo est en français, mais l'application s'affiche en anglais.",
            en: "A word on language. The video is in French, but the application is shown in English." },
          { fr: "Tous les noms de boutons et de menus sont donc dits en anglais, exactement comme à l'écran.",
            en: "So every button and menu name is spoken in English, exactly as on screen." },
          { fr: "Les sous-titres en anglais vous aident à les retrouver.",
            en: "The English subtitles help you find them." },
          { fr: "Nous suivons Nadège Tchouameni, la nouvelle Responsable des Opérations, pendant son premier jour.",
            en: "We follow Nadège Tchouameni, the new Operations Manager, through her first day." },
          { fr: "Les personnes et les données que vous allez voir sont fictives.",
            en: "The people and data you will see are fictional." },
        ],
      }],
    },

    {
      name: "Votre invitation",
      en: "Your invitation",
      shots: [{
        kind: "desktop",
        // The invitation as the product wrote it; the colleague is put back to "invited" first, so a retake meets what a new colleague meets.
        async setup(s) {
          const mail = await ground.invite("nadege", process.env.VIDEO_OUT, { reset: true });
          await s.page.setContent(mailPage(mail));
          await s.settle(800);
        },
        lines: [
          { fr: "Tout commence par un e-mail. Votre administrateur crée votre compte, et vous recevez une invitation.",
            en: "It all starts with an email. Your administrator creates your account and you receive an invitation." },
          { fr: "Le message vous accueille par votre prénom. Le lien expire au bout de soixante-douze heures, et il ne sert qu'une fois.",
            en: "The message greets you by first name. The link expires after seventy-two hours and works only once." },
          { fr: "Appuyez sur «Set my password».",
            en: "Press “Set my password”.",
            do: (s) => s.click(s.page.getByRole("link", { name: /set my password/i }).first()) },
          { fr: "Vous choisissez maintenant votre mot de passe. Il faut au moins douze caractères, avec majuscules, minuscules, un chiffre et un symbole.",
            en: "Now you choose your password. It needs at least twelve characters, with upper and lower case, a number and a symbol." },
          { fr: "Saisissez-le dans «New password». Chaque règle se coche au fur et à mesure que vous tapez.",
            en: "Type it in “New password”. Each rule ticks off as you type.",
            do: (s) => s.type("New password", s.password, { delay: 80 }) },
          { fr: "Saisissez le même mot de passe dans «Confirm password». La dernière règle vérifie que les deux sont identiques.",
            en: "Type the same password in “Confirm password”. The last rule checks that the two match.",
            do: (s) => s.type("Confirm password", s.password, { delay: 80 }) },
          { fr: "Quand toutes les règles sont cochées, appuyez sur «Update Password».",
            en: "When every rule is ticked, press “Update Password”.",
            do: (s) => s.click("Update password") },
          { fr: "Votre mot de passe est enregistré. Appuyez sur «Go to sign in».",
            en: "Your password is saved. Press “Go to sign in”.",
            do: (s) => s.click("Go to sign in") },
        ],
      }],
    },

    {
      name: "Se connecter",
      en: "Signing in",
      shots: [{
        // `still`: the home page's drifting photograph halves the captures a second (6 against 19), so it stands still.
        kind: "desktop", start: "/login", still: true,
        async setup() { await ground.ready([EMAIL]); },
        lines: [
          { fr: "Voici la page d'accueil de votre espace, aux couleurs de «Smart LS». Votre administrateur vous donne son adresse.",
            en: "This is the home page of your workspace, in Smart LS colours. Your administrator gives you its address." },
          { fr: "Appuyez sur «Enter Workspace».",
            en: "Press “Enter Workspace”.",
            do: (s) => s.click("Enter workspace") },
          { fr: "La fenêtre de connexion propose deux onglets : «Password», et «Quick PIN» pour une connexion rapide, que nous verrons dans la deuxième vidéo.",
            en: "The sign-in window has two tabs: Password, and Quick PIN for a faster sign-in, which we cover in the second video.",
            do: async (s) => { await soft(s, s.find("Quick PIN")); await s.wait(0.6); await soft(s, s.find("Password")); } },
          { fr: "Saisissez votre adresse professionnelle dans le champ «Email».",
            en: "Type your work address in the “Email” field.",
            do: (s) => s.type("Email", EMAIL, { delay: 55 }) },
          { fr: "Puis votre mot de passe dans «Password». Les points cachent ce que vous tapez.",
            en: "Then your password in “Password”. The dots hide what you type.",
            do: (s) => s.type("Password", s.password, { delay: 70 }) },
          { fr: "Appuyez sur «Sign In».",
            en: "Press “Sign In”.",
            do: (s) => s.click(s.page.getByRole("button", { name: /^sign in/i }).last()) },
          { fr: "Vous voici dans votre espace de travail. Sa page d'accueil s'appelle la «Control Tower».",
            en: "You are in your workspace. Its home page is called the Control Tower.",
            before: async (s) => { await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); await s.clearOffers(); } },
          { fr: "Votre nom apparaît en haut à droite, avec votre rôle.",
            en: "Your name appears at the top right, with your role.",
            do: (s) => soft(s, s.page.getByRole("button", { name: /^Account:/ })) },
          { fr: "Si l'application propose de créer une clé d'accès, répondez «Not now» pour le moment. Nous y reviendrons.",
            en: "If the app offers to set up a passkey, answer “Not now” for the moment. We come back to it later." },
        ],
      }],
    },

    {
      name: "Mot de passe oublié",
      en: "Forgotten password",
      shots: [{
        kind: "desktop", start: "/login", still: true,
        lines: [
          { fr: "Vous avez oublié votre mot de passe ? Rien de grave.",
            en: "Forgotten your password? No problem." },
          { fr: "Ouvrez la fenêtre de connexion, puis appuyez sur «Forgot password?».",
            en: "Open the sign-in window, then press “Forgot password?”.",
            do: async (s) => { await s.click("Enter workspace"); await s.wait(0.5); await s.click(s.find("Forgot password?")); } },
          { fr: "Saisissez votre e-mail, puis appuyez sur «Send Reset Link».",
            en: "Type your email, then press “Send Reset Link”.",
            do: async (s) => { await s.type("Email", EMAIL, { delay: 55 }); await s.wait(0.4); await s.click(s.find("Send reset link")); } },
          { fr: "Un lien arrive dans votre boîte mail. Il expire au bout de trente minutes et ne sert qu'une fois. Si rien n'arrive, regardez dans vos courriers indésirables.",
            en: "A link arrives in your inbox. It expires after thirty minutes and works only once. If nothing arrives, look in your spam folder." },
          { fr: "L'application répond de la même façon, que l'adresse existe ou non. C'est voulu : cela protège les comptes de vos collègues.",
            en: "The app answers the same way whether or not the address exists. This is deliberate: it protects your colleagues' accounts." },
          { fr: "Le lien vous ramène à la page «Choose a new password», que vous connaissez déjà.",
            en: "The link brings you back to the “Choose a new password” page you already know." },
        ],
      }],
    },

    {
      name: "LIVE et TEST",
      en: "LIVE and TEST",
      shots: [{
        kind: "desktop", as: "nadege", start: "/",
        lines: [
          { fr: "Regardez en haut à droite : deux boutons, «LIVE» et «TEST».",
            en: "Look at the top right: two buttons, LIVE and TEST.",
            do: async (s) => { await soft(s, s.find("LIVE")); await s.wait(0.5); await soft(s, s.find("TEST")); } },
          { fr: "«LIVE» est votre activité réelle. Les dossiers, les factures et les clients que vous y créez sont réels.",
            en: "LIVE is your real business. The files, invoices and clients you create there are real." },
          { fr: "«TEST» est une copie d'entraînement. Rien de ce que vous y faites n'atteint votre activité réelle.",
            en: "TEST is a practice copy. Nothing you do there reaches your real business." },
          { fr: "Praxis LS peut remettre «TEST» à zéro pour repartir d'une base propre. Ce que vous y créez peut donc disparaître.",
            en: "Praxis LS can reset TEST to start from a clean base. What you create there may therefore disappear." },
          { fr: "Appuyez sur «TEST».",
            en: "Press “TEST”.",
            do: (s) => s.click("TEST") },
          { fr: "Une fenêtre demande de confirmer. Elle montre d'où vous partez et où vous allez. La page se recharge, pensez donc à sauvegarder votre travail.",
            en: "A window asks you to confirm. It shows where you are leaving and where you are going. The page reloads, so remember to save your work." },
          { fr: "Appuyez sur «Switch to TEST».",
            en: "Press “Switch to TEST”.",
            do: (s) => s.click(dialog(s, "Switch to TEST?").getByRole("button", { name: /^switch to test$/i })) },
          { fr: "Une bannière orange vous rappelle en permanence que vous êtes dans «TEST».",
            en: "An orange banner reminds you at all times that you are in TEST.",
            before: async (s) => { await s.page.getByText(/TEST MODE/).first().waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); await s.clearOffers(); } },
          { fr: "Pour revenir à votre activité réelle, appuyez sur «Switch to live» dans cette bannière.",
            en: "To go back to your real business, press “Switch to live” in this banner.",
            do: (s) => soft(s, s.find("Switch to live")) },
        ],
      }],
    },

    {
      name: "La Control Tower",
      en: "The Control Tower",
      shots: [{
        kind: "desktop", as: "nadege", start: "/", env: "sandbox",
        lines: [
          { fr: "Retour à la «Control Tower». C'est le premier écran de votre journée.",
            en: "Back to the Control Tower. It is the first screen of your day." },
          { fr: "Le titre résume la situation. Ici, quatre dossiers d'exploitation sont en cours.",
            en: "The headline sums up the situation. Here, four operations files are in motion.",
            do: (s) => soft(s, heading(s, /^your network/i)) },
          { fr: "À droite, deux raccourcis : «New operations file» et «New invoice». C'est ainsi que l'on ouvre un dossier ou une facture.",
            en: "On the right, two shortcuts: “New operations file” and “New invoice”. This is how you open a file or an invoice.",
            do: async (s) => { await soft(s, s.find(/new operations file/i)); await s.wait(0.5); await soft(s, s.find(/new invoice/i)); } },
          { fr: "Le bloc «Filter operations» permet de trier par mode de transport, par territoire, par type de service ou par date.",
            en: "The “Filter operations” block lets you filter by transport mode, territory, service type or date.",
            do: (s) => soft(s, heading(s, /filter operations/i).or(s.page.getByText("Filter operations", { exact: true })).first()) },
          { fr: "Plus bas, la carte «Live shipment map» montre chaque trajet, par mer, par air et par route.",
            en: "Below, the “Live shipment map” shows each journey, by sea, air and road.",
            do: (s) => s.scroll(430) },
          { fr: "À droite de la carte, «Live shipments» liste les expéditions actives, avec leur avancement.",
            en: "Beside the map, “Live shipments” lists the active shipments with their progress.",
            do: (s) => soft(s, s.page.getByText("Live shipments", { exact: true }).first()) },
          { fr: "La carte indique l'heure de sa dernière mise à jour. Chaque personne voit ce que son rôle lui permet de voir.",
            en: "The map shows the time of its last update. Each person sees what their role allows." },
          { fr: "«Not on the map» regroupe les dossiers dont le lieu n'est pas encore vérifié.",
            en: "“Not on the map” groups the files whose location is not yet verified.",
            do: (s) => s.scroll(380) },
          { fr: "Tout en bas, «Applications» ouvre chaque module, et «Recent activity» montre ce qui vient de se passer.",
            en: "At the bottom, “Applications” opens every module, and “Recent activity” shows what just happened.",
            do: (s) => s.scroll(700) },
        ],
      }],
    },

    {
      name: "Votre espace sur ordinateur",
      en: "The desktop workspace",
      shots: [{
        kind: "desktop", as: "nadege", start: "/", env: "sandbox",
        lines: [
          { fr: "Faisons le tour de l'espace de travail, en commençant par la barre du haut.",
            en: "Let's tour the workspace, starting with the top bar." },
          { fr: "À gauche, le logo et le nom de votre entreprise.",
            en: "On the left, your company's logo and name.",
            do: (s) => soft(s, s.page.getByText("Smart Logistics & Services Ltd", { exact: true }).first()) },
          { fr: "La recherche vous mène partout. Appuyez sur «Search», ou sur Contrôle et K.",
            en: "Search takes you anywhere. Press “Search”, or Control and K.",
            do: (s) => s.click(s.find("Search")) },
          { fr: "Tapez «invoice» : l'application propose des pages, des onglets et des actions.",
            en: "Type “invoice”: the app offers pages, tabs and actions.",
            do: async (s) => { await s.page.keyboard.type("invoice", { delay: 90 }); await s.wait(0.8); } },
          { fr: "Appuyez sur Échap pour fermer.",
            en: "Press Escape to close.",
            do: (s) => s.key("Escape") },
          { fr: "Le bouton «Clock In» enregistre votre pointage d'arrivée.",
            en: "The “Clock In” button records your arrival.",
            do: (s) => soft(s, s.find("Clock In")) },
          { fr: "Le bouton «FR» passe l'interface en français. Pour cette formation, nous restons en anglais.",
            en: "The “FR” button switches the interface to French. For this training we stay in English.",
            do: (s) => soft(s, s.page.getByRole("button", { name: /passer en français|^fr$/i }).first()) },
          { fr: "À côté, le soleil change le thème, et la cloche affiche vos notifications.",
            en: "Next to it, the sun changes the theme, and the bell shows your notifications.",
            do: async (s) => { await soft(s, s.page.getByRole("button", { name: /^theme/i }).first()); await s.wait(0.4); await soft(s, s.page.getByRole("button", { name: /^notifications/i }).first()); } },
          { fr: "Votre nom ouvre le menu du compte, avec «My HR», «My security», «My appearance», «Lock screen» et «Sign out».",
            en: "Your name opens the account menu, with “My HR”, “My security”, “My appearance”, “Lock screen” and “Sign out”.",
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /^Account:/ })); await s.wait(2.5); await s.key("Escape"); } },
          { fr: "Sous la barre, le ruban range les modules en six familles : «Monitor», «Configure», «Empower», «Engage», «Fulfil» et «Transact».",
            en: "Under the bar, the ribbon groups the modules into six families: Monitor, Configure, Empower, Engage, Fulfil and Transact.",
            do: (s) => tour(s, ["Monitor", "Configure", "Empower", "Engage", "Fulfil", "Transact"].map((n) => s.find(n)), 0.45) },
          { fr: "Sous «Monitor», on trouve la «Control Tower», «My Workspace», «Praxis AI» et «Smart Comms».",
            en: "Under Monitor you find the Control Tower, My Workspace, Praxis AI and Smart Comms.",
            do: (s) => tour(s, ["Control Tower", "My Workspace", "Praxis AI", "Smart Comms"].map((n) => s.page.getByRole("tab", { name: new RegExp(`^${n}$`, "i") }).or(s.page.getByRole("link", { name: new RegExp(`^${n}$`, "i") })).first()), 0.4) },
          { fr: "Chaque famille s'ouvre sur ses propres onglets. «Fulfil» contient les opérations, avec «Files», «Milestones», «Transit Orders» et «Delivery Notes».",
            en: "Each family opens on its own tabs. Fulfil holds operations, with Files, Milestones, Transit Orders and Delivery Notes.",
            do: async (s) => { await s.click(s.find("Fulfil")); await tour(s, ["Files", "Milestones", "Transit Orders", "Delivery Notes"].map((n) => sub(s, n)), 0.35); } },
          { fr: "«Transact» contient la finance, avec «Invoices», «Receivables», «Journals» et «Statements».",
            en: "Transact holds finance, with Invoices, Receivables, Journals and Statements.",
            do: async (s) => { await s.click(s.find("Transact")); await tour(s, ["Invoices", "Receivables", "Journals", "Statements"].map((n) => sub(s, n)), 0.35); } },
          { fr: "«Configure» range les données de base, «Empower» les équipes, et «Engage» les ventes.",
            en: "Configure holds the master data, Empower the people, and Engage the sales.",
            do: (s) => tour(s, ["Configure", "Empower", "Engage"].map((n) => s.find(n)), 0.5) },
          { fr: "La colonne de gauche garde vos raccourcis. Le bouton plus, «Edit shortcuts», permet de les choisir.",
            en: "The left column keeps your shortcuts. The plus button, “Edit shortcuts”, lets you choose them.",
            before: (s) => s.click(s.find("Monitor")),
            do: (s) => soft(s, s.find("Edit shortcuts")) },
          { fr: "Les flèches «Back» et «Forward» fonctionnent comme dans un navigateur, et «Refresh data» recharge les chiffres.",
            en: "The “Back” and “Forward” arrows work like a browser's, and “Refresh data” reloads the figures.",
            do: async (s) => { await soft(s, s.page.getByRole("button", { name: /^back/i }).first()); await s.wait(0.3); await soft(s, s.page.getByRole("button", { name: /^refresh data/i }).first()); } },
          { fr: "Et si vous avez besoin d'aide, le point d'interrogation en bas ouvre «Help».",
            en: "And if you need help, the question mark at the bottom opens “Help”.",
            do: (s) => soft(s, s.find("Help")) },
        ],
      }],
    },

    {
      name: "Sur téléphone",
      en: "On your phone",
      shots: [{
        kind: "phone", start: "/login", still: true,
        label: { eyebrow: "Sur téléphone · On the phone", title: "Serge Ndzana", subtitle: "Finance Manager, dans son navigateur" },
        lines: [
          { fr: "Passons au téléphone. Serge Ndzana, le Responsable Financier, ouvre l'application dans son navigateur.",
            en: "Now the phone. Serge Ndzana, the Finance Manager, opens the app in his browser." },
          { fr: "Praxis LS fonctionne dans le navigateur, sans rien installer. On peut aussi l'ajouter à l'écran d'accueil.",
            en: "Praxis LS runs in the browser, with nothing to install. It can also be added to the home screen." },
          { fr: "Appuyez sur «Enter Workspace».",
            en: "Tap “Enter Workspace”.",
            do: (s) => s.click("Enter workspace") },
          { fr: "Saisissez votre e-mail et votre mot de passe, puis appuyez sur «Sign In».",
            en: "Type your email and password, then tap “Sign In”.",
            do: async (s) => {
              await s.type("Email", SERGE, { delay: 60 });
              await s.type("Password", s.password, { delay: 70 });
              await s.click(s.page.getByRole("button", { name: /^sign in/i }).last());
            } },
          { fr: "L'écran est pensé pour le pouce. En haut : le menu, la recherche, l'environnement, les notifications et votre compte.",
            en: "The screen is designed for the thumb. At the top: the menu, search, the environment, notifications and your account.",
            before: async (s) => { await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); await s.clearOffers(); } },
          { fr: "En bas, les six familles du ruban deviennent la barre de navigation : «Monitor», «Configure», «Empower», «Engage», «Fulfil» et «Transact».",
            en: "At the bottom, the six ribbon families become the navigation bar: Monitor, Configure, Empower, Engage, Fulfil and Transact." },
          { fr: "Appuyez sur une famille, par exemple «Fulfil». Une feuille s'ouvre, avec les écrans des opérations et de la flotte.",
            en: "Tap a family, for example “Fulfil”. A sheet opens, with the operations and fleet screens.",
            do: (s) => s.click("Fulfil") },
          { fr: "Le bouton «LIVE» en haut montre l'environnement. Appuyez dessus pour passer en «TEST», avec la même confirmation que sur ordinateur.",
            en: "The “LIVE” button at the top shows the environment. Tap it to switch to TEST, with the same confirmation as on a computer.",
            before: (s) => s.click("Close"),
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /data environment/i }).first()); await s.wait(2.8); await s.click(s.page.getByRole("dialog").last().getByRole("button", { name: /stay in live/i })); } },
        ],
      }],
    },

    {
      name: "Se déconnecter",
      en: "Signing out",
      shots: [{
        kind: "desktop", as: "nadege", start: "/", env: "sandbox",
        lines: [
          { fr: "Pour finir votre journée, ouvrez le menu du compte, en haut à droite.",
            en: "To end your day, open the account menu at the top right.",
            do: (s) => s.click(s.page.getByRole("button", { name: /^Account:/ })) },
          { fr: "«Lock screen» verrouille l'écran quand vous vous absentez un instant. Nous le verrons dans la deuxième vidéo.",
            en: "“Lock screen” locks the screen when you step away for a moment. We cover it in the second video.",
            do: (s) => soft(s, s.page.getByRole("menuitem", { name: /lock screen/i }).or(s.find("Lock screen")).first()) },
          { fr: "Pour quitter, appuyez sur «Sign out».",
            en: "To leave, press “Sign out”.",
            do: (s) => s.click(s.page.getByRole("button", { name: /^sign out$/i }).or(s.page.getByRole("menuitem", { name: /^sign out$/i })).first()) },
          { fr: "Une fenêtre demande confirmation. Appuyez de nouveau sur «Sign out».",
            en: "A window asks for confirmation. Press “Sign out” again.",
            do: (s) => s.click(s.page.getByRole("dialog").last().getByRole("button", { name: /^sign out$/i })) },
          { fr: "Vous revenez à la fenêtre de connexion. Cet appareil vous reconnaît et vous salue par votre prénom.",
            en: "You return to the sign-in window. This device recognises you and greets you by first name." },
          { fr: "Sur un ordinateur partagé, appuyez sur «Not you?» pour laisser la place à un collègue.",
            en: "On a shared computer, press “Not you?” to make room for a colleague.",
            do: (s) => soft(s, s.find("Not you?")) },
        ],
      }],
    },

    {
      name: "Pour conclure",
      en: "Wrapping up",
      shots: [{
        kind: "card", card: "closing",
        lines: [
          { fr: "Voilà pour la prise en main. Vous savez recevoir votre invitation, vous connecter, et retrouver un mot de passe oublié.",
            en: "That wraps up getting started. You can receive your invitation, sign in and recover a forgotten password." },
          { fr: "Vous savez aussi distinguer «LIVE» et «TEST», lire la «Control Tower», et vous repérer sur ordinateur comme sur téléphone.",
            en: "You can also tell LIVE from TEST, read the Control Tower, and find your way around on a computer and a phone." },
          { fr: "Dans la prochaine vidéo, nous verrons des connexions plus sûres : «Quick PIN», clés d'accès et vérification en deux étapes.",
            en: "In the next video we cover safer sign-in: Quick PIN, passkeys and two-step verification." },
          { fr: "Merci d'avoir regardé.",
            en: "Thank you for watching." },
        ],
      }],
    },
  ],
};
