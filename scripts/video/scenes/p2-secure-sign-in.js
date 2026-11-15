"use strict";
/**
 * Praxis LS, part 2 of the introduction: Se connecter en toute sécurité (Signing in safely).
 *
 * The narration is French and the application stays in English on purpose (see part 1): every
 * button, tab and menu a viewer must find is said in English between « and », exactly as the screen
 * reads it, and the subtitle under the picture is the English translation of the French line.
 *
 * It follows Nadège Tchouameni (the Operations Manager of part 1) through the three quick ways
 * back in that replace typing a password: a passkey (Windows Hello on her computer), a Quick PIN
 * and the lock screen; then Serge Ndzana, the Finance Manager, turns on two-step verification and
 * signs in on his phone with a code. About six minutes.
 *
 * Everything on screen is real: the passkey is made by the browser's own built-in reader (the
 * filming engine's virtual authenticator, with a finger it puts on the reader at the right moment),
 * the Quick PIN is set and used through the product's own screens, and the code on the phone is the
 * one an authenticator app would show for the key the product printed. Each chapter starts from
 * "no way in but the password" (`ground.resetSecurity`), so a retake meets what a first time does.
 *
 * Decided with JBS Praxis, 15/11/2026 (see part 1 and doc/TRAINING_VIDEOS.md).
 */
const ground = require("../ground");
const { soft } = require("../helpers");

const NADEGE = "nadege.tchouameni@smartls.test";
const SERGE = "serge.ndzana@smartls.test";
/** The PIN Nadège chooses on camera, and the weak one she is refused first. Invented, like her. */
const PIN = "7391";
const WEAK_PIN = "1234";

/** Open a person's own security page, ready to film: their ways in reset, the page fresh. */
const mySecurity = async (s, email, what) => {
  await ground.resetSecurity([email], what);
  await s.go("/security/my-security");
  await s.clearOffers();
};

/** Register a passkey on this device, off camera, so a chapter can start from "this device has one". */
const enrolPasskey = async (s) => {
  await s.click(s.page.getByRole("button", { name: /^set up (a passkey|windows hello)$/i }).first());
  await s.touch();
  await s.page.getByText(/now signs you in on this device/i).first().waitFor({ state: "visible", timeout: 15000 });
};

/** The six boxes of a code, by their label. */
const codeBoxes = (s) => s.page.locator("input[autocomplete=one-time-code]").first();

module.exports = {
  id: "p2-secure-sign-in",
  file: "Praxis-LS-02-Connexion-Securisee-FR-EN",
  meta: { title: "Praxis LS · Se connecter en toute sécurité / Signing in safely (Part 2)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Formation Praxis LS · Partie 2",
    title: "Se connecter en toute sécurité",
    subtitle: "Clé d'accès, Quick PIN, écran verrouillé et double vérification",
    english: "Signing in safely: passkey, Quick PIN, lock screen and two-step verification",
    left: "Une visite guidée en français, sous-titrée en anglais",
  },
  closing: {
    eyebrow: "Formation Praxis LS · Partie 2",
    title: "Merci",
    subtitle: "À bientôt pour la suite : le travail de tous les jours",
    english: "Thank you. See you for what comes next: day-to-day work",
    left: "smartls.praxisls.com",
  },

  /** The ground: branding, company, cast, the TEST sample data. Nobody is invited: part 1 did that. */
  async prepare({ log }) {
    await ground.applyBranding(log);
    await ground.ensureCast({ log });
    await ground.ensureSandboxData(log);
    await ground.ready([NADEGE, SERGE]);
    await ground.resetSecurity([NADEGE, SERGE]);
    log("ground ready");
  },

  chapters: [
    {
      name: "Bienvenue",
      en: "Welcome",
      shots: [{
        kind: "card", card: "opening",
        lines: [
          { fr: "Bienvenue dans la deuxième partie de la présentation de «Praxis LS». Elle porte sur la façon de vous connecter, plus vite et plus sûrement.",
            en: "Welcome to the second part of the Praxis LS introduction. It is about signing in faster and more safely." },
          { fr: "Votre mot de passe reste la base. Mais il existe trois façons rapides de revenir dans votre espace sans le taper.",
            en: "Your password remains the base. But there are three quick ways back into your workspace without typing it." },
          { fr: "La clé d'accès, qui se déverrouille d'un seul geste. Le «Quick PIN», un code à quatre chiffres. Et l'écran verrouillé, quand vous vous absentez.",
            en: "The passkey, which unlocks with a single touch. The Quick PIN, a four-digit code. And the lock screen, for when you step away." },
          { fr: "Nous verrons aussi la vérification en deux étapes, qui demande un code en plus du mot de passe.",
            en: "We also cover two-step verification, which asks for a code on top of your password." },
          { fr: "Comme dans la première partie, l'application reste en anglais, et les noms de boutons sont dits en anglais.",
            en: "As in the first part, the application stays in English, and button names are spoken in English." },
          { fr: "Nous retrouvons Nadège Tchouameni, ainsi que Serge Ndzana. Les personnes et les données sont fictives.",
            en: "We meet Nadège Tchouameni again, along with Serge Ndzana. The people and data are fictional." },
        ],
      }],
    },

    {
      name: "Votre clé d'accès",
      en: "Your passkey",
      shots: [{
        // The sign-in is filmed from the start: the passkey is offered right after a first sign-in on a device.
        // `authenticator`: the browser has a built-in reader (Windows Hello), and `touch()` puts a finger on it.
        kind: "desktop", start: "/login", still: true, authenticator: true,
        async setup() { await ground.ready([NADEGE]); await ground.resetSecurity([NADEGE]); },
        lines: [
          { fr: "Nadège se connecte comme d'habitude, avec son e-mail et son mot de passe. Appuyez sur «Enter Workspace».",
            en: "Nadège signs in as usual, with her email and password. Press “Enter Workspace”.",
            do: async (s) => { await s.wait(4.6); await s.click("Enter workspace"); } },
          { fr: "Elle saisit son e-mail et son mot de passe, puis appuie sur «Sign In».",
            en: "She types her email and password, then presses “Sign In”.",
            do: async (s) => {
              await s.type("Email", NADEGE, { delay: 50 });
              await s.type("Password", s.password, { delay: 60 });
              await s.click(s.page.getByRole("button", { name: /^sign in$/i }).last());
            } },
          { fr: "Sur un ordinateur qui peut la garder, une fenêtre propose aussitôt une clé d'accès : «One touch next time».",
            en: "On a computer that can hold one, a window immediately offers a passkey: “One touch next time”.",
            before: (s) => s.page.getByRole("button", { name: /^set up /i }).first().waitFor({ state: "visible", timeout: 30000 }).then(() => s.settle(500)) },
          { fr: "Une clé d'accès appartient à cet appareil seul. Votre empreinte ou votre visage ne le quittent jamais, et personne ne peut la deviner.",
            en: "A passkey belongs to this device alone. Your fingerprint or face never leaves it, and nobody can guess it." },
          { fr: "Sous Windows, le bouton s'appelle «Set up Windows Hello». Appuyez dessus.",
            en: "On Windows, the button is called “Set up Windows Hello”. Press it.",
            do: (s) => s.click(s.page.getByRole("button", { name: /^set up (windows hello|your passkey|a passkey)$/i }).first()) },
          { fr: "L'ordinateur attend maintenant votre geste : le message dit «Waiting for your device».",
            en: "The computer now waits for your touch: the message says “Waiting for your device”.",
            hold: 1.2 },
          { fr: "Posez le doigt sur le lecteur, ou regardez la caméra. La clé d'accès est créée, et vous êtes connecté.",
            en: "Put your finger on the reader, or look at the camera. The passkey is created, and you are signed in.",
            do: (s) => s.touch(),
            after: async (s) => { await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); } },
          { fr: "Si vous préférez ne pas le faire maintenant, «Not now» repousse la proposition d'une semaine.",
            en: "If you would rather not do it now, “Not now” postpones the offer for a week." },
        ],
      }],
    },

    {
      name: "Ma sécurité",
      en: "My Security",
      shots: [{
        kind: "desktop", as: "nadege", start: "/", authenticator: true,
        async setup(s) {
          await mySecurity(s, NADEGE, ["passkeys", "pin", "authenticator"]);
          await enrolPasskey(s);
          await s.go("/");
          await s.clearOffers();
        },
        lines: [
          { fr: "Vos moyens de connexion se gèrent au même endroit. Ouvrez le menu du compte, puis appuyez sur «My security».",
            en: "Your ways of signing in are managed in one place. Open the account menu, then press “My security”.",
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /^Account:/ })); await s.click(s.page.getByRole("menuitem", { name: /^my security$/i }).first()); } },
          { fr: "La page «My Security» commence par la clé d'accès. Elle indique que cet appareil vous connecte avec «Windows Hello».",
            en: "The My Security page starts with the passkey. It says this device signs you in with Windows Hello.",
            do: (s) => soft(s, s.page.getByText(/this device signs you in with/i).first()) },
          { fr: "Plus bas, la liste «Your passkeys» montre chaque appareil enregistré, sa date, et son dernier usage.",
            en: "Further down, the “Your passkeys” list shows each registered device, its date and its last use.",
            do: async (s) => { await s.scroll(240); await soft(s, s.page.getByText("Your passkeys").first()); } },
          { fr: "«Remove» retire la clé de cet appareil. Une fenêtre demande confirmation, car il faudra la recréer.",
            en: "“Remove” takes the passkey off this device. A window asks for confirmation, because you would have to create it again.",
            do: (s) => soft(s, s.find("Remove")) },
          { fr: "Au-dessus, une carte pour le mot de passe. En dessous, l'application d'authentification, et le «Quick PIN».",
            en: "Above, a card for the password. Below, the authenticator app, and the Quick PIN.",
            do: async (s) => { await s.scroll(420); await soft(s, s.page.getByText("Quick PIN", { exact: true }).first()); } },
        ],
      }],
    },

    {
      name: "Le Quick PIN",
      en: "The Quick PIN",
      shots: [{
        kind: "desktop", as: "nadege", start: "/security/my-security",
        async setup(s) {
          await mySecurity(s, NADEGE, ["pin"]);
          await s.scroll(900);
        },
        lines: [
          { fr: "Le «Quick PIN» est un code à quatre chiffres. Il vous connecte sur n'importe quel appareil : votre ordinateur, votre téléphone, partout.",
            en: "The Quick PIN is a four-digit code. It signs you in on any device: your computer, your phone, anywhere.",
            do: (s) => soft(s, s.page.getByText("Quick PIN", { exact: true }).first()) },
          { fr: "Saisissez-le dans «PIN (4 digits)». Les chiffres simples sont refusés : une suite comme celle-ci ne passe pas.",
            en: "Type it in “PIN (4 digits)”. Simple digits are refused: a run like this one does not pass.",
            do: async (s) => { await s.type("PIN (4 digits)", WEAK_PIN, { delay: 160 }); await s.type("Confirm PIN", WEAK_PIN, { delay: 160 }); } },
          { fr: "Choisissez un code moins devinable, et confirmez-le dans «Confirm PIN».",
            en: "Choose a code that is harder to guess, and confirm it in “Confirm PIN”.",
            do: async (s) => { await s.type("PIN (4 digits)", PIN, { delay: 160 }); await s.type("Confirm PIN", PIN, { delay: 160 }); } },
          { fr: "Appuyez sur «Set up Quick PIN». Le code est actif sur tous vos appareils.",
            en: "Press “Set up Quick PIN”. The code is active on all your devices.",
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /^set up quick pin$/i })); await s.wait(0.8); await s.scroll(360); } },
          { fr: "Attention : cinq codes faux de suite désactivent le «Quick PIN» partout. Vous pourrez le recréer avec votre mot de passe.",
            en: "Careful: five wrong codes in a row switch the Quick PIN off everywhere. You can create it again with your password.",
            do: (s) => soft(s, s.page.getByText(/five wrong tries in a row/i).first()) },
        ],
      }],
      // The same device, later: the PIN replaces the password.
    },

    {
      name: "Se connecter avec le PIN",
      en: "Signing in with the PIN",
      shots: [{
        kind: "desktop", start: "/login", still: true,
        async setup(s) {
          // The device must know Nadège to offer her PIN: a real sign-in and sign-out, off camera, as on any day.
          await ground.ready([NADEGE]);
          await ground.resetSecurity([NADEGE], ["passkeys"]);
          await ground.setQuickPin(NADEGE, PIN);
          await s.page.getByRole("button", { name: /enter workspace/i }).click();
          await s.page.getByLabel("Email", { exact: true }).fill(NADEGE);
          await s.page.getByLabel("Password", { exact: true }).fill(s.password);
          await s.page.getByRole("button", { name: /^sign in$/i }).last().click();
          await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 });
          await s.settle(700);
          await s.clearOffers();
          await s.page.getByRole("button", { name: /^Account:/ }).click();
          await s.page.getByText("Sign out", { exact: true }).click();
          await s.page.getByRole("dialog").last().getByRole("button", { name: /^sign out$/i }).click();
          await s.page.getByText(/welcome back/i).first().waitFor({ state: "visible", timeout: 20000 });
          await s.settle(900);
        },
        lines: [
          { fr: "Quand Nadège revient, l'appareil la reconnaît et lui propose directement son code : «Quick PIN».",
            en: "When Nadège comes back, the device recognises her and offers her code straight away: “Quick PIN”." },
          { fr: "Saisissez les quatre chiffres. Pas d'e-mail à retaper, pas de mot de passe.",
            en: "Type the four digits. No email to retype, no password.",
            // Three digits here and the fourth with the next line: the fourth is what signs her in, and it should land with the words that say so.
            do: async (s) => { await s.page.keyboard.type(PIN.slice(0, 3), { delay: 700 }); } },
          { fr: "Dès le quatrième chiffre, la connexion se fait toute seule, et Nadège est de retour dans son espace.",
            en: "As soon as the fourth digit is in, the sign-in happens by itself, and Nadège is back in her workspace.",
            do: async (s) => { await s.page.keyboard.type(PIN.slice(3), { delay: 100 }); },
            after: async (s) => { await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); } },
          { fr: "Si le code vous échappe, «Use Password» ramène au mot de passe.",
            en: "If the code escapes you, “Use Password” takes you back to the password." },
        ],
      }],
    },

    {
      name: "L'écran verrouillé",
      en: "The lock screen",
      shots: [{
        kind: "desktop", as: "nadege", start: "/security/my-security", authenticator: true,
        // The lock screen offers the PIN beside the passkey only when the account has one when she signs in (the sign-in
        // carries the flag), so a retake of this chapter alone gives her one first.
        ground: async () => { await ground.resetSecurity([NADEGE], ["pin"]); await ground.setQuickPin(NADEGE, PIN); },
        async setup(s) {
          await mySecurity(s, NADEGE, ["passkeys"]);
          await enrolPasskey(s);
          await s.go("/");
          await s.clearOffers();
        },
        lines: [
          { fr: "Vous vous absentez de votre poste ? Ouvrez le menu du compte.",
            en: "Stepping away from your desk? Open the account menu.",
            do: (s) => s.click(s.page.getByRole("button", { name: /^Account:/ })) },
          { fr: "Appuyez sur «Lock screen». L'écran se floute et se verrouille. Rien n'est lisible, et rien n'est perdu.",
            en: "Press “Lock screen”. The screen blurs and locks. Nothing is readable, and nothing is lost.",
            do: (s) => s.click(s.page.getByText("Lock screen", { exact: true }).first()),
            hold: 0.8 },
          { fr: "Le verrouillage se fait aussi tout seul, après un moment sans activité, et au bout de deux heures.",
            en: "Locking also happens on its own, after a while with no activity, and after two hours.",
            do: (s) => soft(s, s.page.getByText(/session locked/i).first()) },
          { fr: "Pour rouvrir, la clé d'accès passe en premier : l'ordinateur attend votre geste.",
            en: "To reopen, the passkey comes first: the computer waits for your touch." },
          { fr: "Sans clé d'accès, le même écran propose «Use PIN», pour votre «Quick PIN», ou «Use Password».",
            en: "Without a passkey, the same screen offers “Use PIN”, for your Quick PIN, or “Use Password”.",
            do: async (s) => { await soft(s, s.find("Use PIN")); await s.wait(0.4); await soft(s, s.find("Use Password")); } },
          { fr: "Posez le doigt sur le lecteur. L'écran se déverrouille, exactement là où vous vous étiez arrêté.",
            en: "Put your finger on the reader. The screen unlocks, exactly where you left off.",
            do: (s) => s.touch(),
            after: async (s) => { await s.page.locator("#praxis-lock-root").waitFor({ state: "detached", timeout: 20000 }); await s.settle(900); } },
        ],
      }],
    },

    {
      name: "La vérification en deux étapes",
      en: "Two-step verification",
      shots: [{
        kind: "desktop", as: "serge", start: "/security/my-security",
        // Serge may have two-step verification on from an earlier take: he could not be signed in off camera with it.
        ground: () => ground.resetSecurity([SERGE]),
        async setup(s) {
          await mySecurity(s, SERGE, ["passkeys", "pin", "authenticator"]);
          await s.scroll(900);
        },
        lines: [
          { fr: "Pour protéger davantage un compte, Serge ajoute une deuxième étape : un code qui change toutes les trente secondes.",
            en: "To protect an account further, Serge adds a second step: a code that changes every thirty seconds.",
            do: (s) => soft(s, s.page.getByText("Authenticator App", { exact: true }).first()) },
          { fr: "Dans «Authenticator App», appuyez sur «Set Up».",
            en: "In “Authenticator App”, press “Set Up”.",
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /^set up$/i })); await s.wait(0.8); await s.scroll(300); } },
          { fr: "Un carré s'affiche. Avec une application comme «Google Authenticator», vous le scannez avec la caméra du téléphone.",
            en: "A square appears. With an app such as Google Authenticator, you scan it with the phone's camera." },
          { fr: "Sans caméra, appuyez sur «No camera?». La clé de configuration s'affiche, et vous la saisissez dans l'application.",
            en: "With no camera, press “No camera?”. The setup key appears, and you type it into the app.",
            do: async (s) => { await s.click(s.page.getByRole("button", { name: /^no camera\?$/i })); await s.wait(0.5); await s.scroll(220); await soft(s, s.page.getByLabel("Setup key")); } },
          { fr: "L'application montre alors un code à six chiffres. Saisissez-le : il est vérifié aussitôt.",
            en: "The app then shows a six-digit code. Type it in: it is checked straight away.",
            do: async (s) => {
              const key = await s.page.getByLabel("Setup key").inputValue();
              const code = await ground.freshCode(key);
              await codeBoxes(s).click();
              await s.page.keyboard.type(code, { delay: 190 });
            } },
          { fr: "Dix codes de secours s'affichent, une seule fois. Chacun vous connecte une fois si vous perdez votre téléphone. Gardez-les en lieu sûr.",
            en: "Ten recovery codes appear, once only. Each one signs you in once if you lose your phone. Keep them somewhere safe.",
            do: (s) => soft(s, s.page.getByText(/save these/i).first()) },
          { fr: "Appuyez sur «Done». Une fenêtre demande si vous avez bien gardé les codes : appuyez sur «Yes, Saved».",
            en: "Press “Done”. A window asks whether you have kept the codes: press “Yes, Saved”.",
            do: async (s) => {
              await s.click(s.page.getByRole("button", { name: /^done$/i }));
              await s.wait(0.6);
              await s.click(s.page.getByRole("dialog").last().getByRole("button", { name: /^yes, saved$/i }));
            } },
          { fr: "L'application d'authentification est activée. Le choix «Ask for a Code» règle la fréquence : à chaque connexion, chaque jour, ou chaque mois.",
            en: "The authenticator app is on. The “Ask for a Code” choice sets how often: at every sign-in, daily or monthly.",
            do: async (s) => { await soft(s, s.page.getByText("Ask for a Code").first()); await s.wait(0.4); await soft(s, s.find("Every Sign-In")); } },
        ],
      }],
    },

    {
      name: "Sur téléphone, avec le code",
      en: "On the phone, with the code",
      shots: [{
        kind: "phone", start: "/login", still: true,
        label: { eyebrow: "Sur téléphone · On the phone", title: "Serge Ndzana", subtitle: "Connexion en deux étapes" },
        async setup(s) {
          await ground.ready([SERGE]);
          await ground.resetSecurity([SERGE]);
          s.secret = await ground.enableAuthenticator(SERGE);
        },
        lines: [
          { fr: "Sur son téléphone, Serge se connecte comme avant. Appuyez sur «Enter Workspace».",
            en: "On his phone, Serge signs in as before. Tap “Enter Workspace”.",
            do: async (s) => { await s.wait(3.4); await s.click("Enter workspace"); } },
          { fr: "Il saisit son e-mail et son mot de passe, puis appuie sur «Sign In».",
            en: "He types his email and password, then taps “Sign In”.",
            do: async (s) => {
              await s.type("Email", SERGE, { delay: 55 });
              await s.type("Password", s.password, { delay: 65 });
              await s.click(s.page.getByRole("button", { name: /^sign in$/i }).last());
            } },
          { fr: "Le mot de passe est vérifié, mais l'accès n'est pas encore ouvert : l'écran demande le code, «Two-step verification».",
            en: "The password is verified, but access is not open yet: the screen asks for the code, “Two-step verification”.",
            before: (s) => s.page.getByText(/two-step verification/i).first().waitFor({ state: "visible", timeout: 20000 }).then(() => s.settle(500)) },
          { fr: "Téléphone perdu ? Sur cet écran, «Lost your phone?» permet d'utiliser un code de secours à la place.",
            en: "Lost your phone? On this screen, “Lost your phone?” lets you use a recovery code instead." },
          { fr: "Il ouvre son application d'authentification, et saisit les six chiffres affichés.",
            en: "He opens his authenticator app and types the six digits shown.",
            // Five digits here and the sixth with the next line: the sixth is what verifies it.
            do: async (s) => {
              s.code = await ground.freshCode(s.secret, 20);
              await codeBoxes(s).tap();
              await s.page.keyboard.type(s.code.slice(0, 5), { delay: 520 });
            } },
          { fr: "Le dernier chiffre vérifie le code, et Serge est dans son espace.",
            en: "The last digit checks the code, and Serge is in his workspace.",
            do: (s) => s.page.keyboard.type(s.code.slice(5), { delay: 100 }),
            after: async (s) => { await s.page.getByRole("button", { name: /^Account:/ }).waitFor({ state: "visible", timeout: 30000 }); await s.settle(900); } },
        ],
      }],
    },

    {
      name: "Pour conclure",
      en: "Wrapping up",
      shots: [{
        kind: "card", card: "closing",
        lines: [
          { fr: "Voilà pour la connexion sûre. Vous savez créer une clé d'accès, régler votre «Quick PIN» et verrouiller votre écran.",
            en: "That wraps up safe sign-in. You can create a passkey, set up your Quick PIN and lock your screen." },
          { fr: "Vous savez aussi activer la vérification en deux étapes, et vous connecter avec un code, sur ordinateur comme sur téléphone.",
            en: "You can also turn on two-step verification, and sign in with a code, on a computer and on a phone." },
          { fr: "Un conseil : gardez votre mot de passe, et ajoutez au moins un moyen rapide. Le plus pratique est la clé d'accès.",
            en: "One piece of advice: keep your password, and add at least one quick way in. The most convenient is the passkey." },
          { fr: "Les prochaines vidéos suivent le travail de tous les jours.",
            en: "The next videos follow day-to-day work." },
          { fr: "Merci d'avoir regardé.",
            en: "Thank you for watching." },
        ],
      }],
    },
  ],
};
