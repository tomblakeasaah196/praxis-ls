/**
 * Superseded. The pre-auth experience is now the cinematic landing hero with a
 * sign-in modal — see features/landing/landing-page.tsx and
 * features/auth/login-modal.tsx. This thin re-export keeps any lingering import
 * working; prefer importing LandingPage directly.
 */
export { LandingPage as LoginPage } from "@/features/landing/landing-page";
