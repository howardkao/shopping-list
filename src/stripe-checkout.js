// TODO: configure Stripe product URL once the Stripe account + product are set up.
// The URL comes from Stripe Dashboard -> Products -> [Product] -> Pricing Plans -> "Copy link"
// for a Checkout Link, or is constructed from a Checkout Session via a worker.
// Until then, web users are not gated; see src/subscriptions.js isWriteAllowed().
const STRIPE_CHECKOUT_URL = (import.meta.env.VITE_STRIPE_CHECKOUT_URL || '').trim();

export async function redirectToStripeCheckout() {
  if (!STRIPE_CHECKOUT_URL) {
    return { success: false, unavailable: true, reason: 'stripe_url_not_configured' };
  }
  window.location.assign(STRIPE_CHECKOUT_URL);
  return { success: true, pending: true };
}
