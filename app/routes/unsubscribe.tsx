import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { unauthenticated } from "../shopify.server";
import { unsubscribeCustomer } from "../shopify/customers.server";
import { verifyUnsubscribe } from "../email/unsubscribe";
import { env } from "../utils/env.server";
import { logger } from "../utils/logger.server";

// Public (no Shopify login): the signed token in the link is the only credential.

const tokenFrom = async (request: Request) => {
  const url = new URL(request.url);
  return url.searchParams.get("t") ?? "";
};

/** A mail scanner or link prefetcher opens GET links, so GET only asks; the POST does the unsubscribing. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = await tokenFrom(request);
  return { token: verifyUnsubscribe(token, env.SHOPIFY_API_SECRET) ? token : null };
};

/** Also the target of the one-click List-Unsubscribe-Post request mail clients send. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const payload = verifyUnsubscribe(await tokenFrom(request), env.SHOPIFY_API_SECRET);
  if (!payload) return Response.json({ done: false, error: "invalid" }, { status: 400 });
  try {
    const { admin } = await unauthenticated.admin(payload.shop);
    await unsubscribeCustomer(admin, payload.customerId);
    return { done: true, error: null };
  } catch (err) {
    logger.error({ err, shop: payload.shop }, "unsubscribe failed");
    return Response.json({ done: false, error: "failed" }, { status: 500 });
  }
};

const page: React.CSSProperties = {
  maxWidth: 460,
  margin: "15vh auto 0",
  padding: "0 20px",
  fontFamily: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  textAlign: "center",
  color: "#1a1a1a",
};

export default function Unsubscribe() {
  const { token } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  if (!token) {
    return (
      <main style={page}>
        <h1>This link is not valid</h1>
        <p>It may have been copied incorrectly. Use the unsubscribe link in your latest email.</p>
      </main>
    );
  }
  if (result?.done) {
    return (
      <main style={page}>
        <h1>You are unsubscribed</h1>
        <p>You will no longer receive marketing emails from us.</p>
      </main>
    );
  }
  return (
    <main style={page}>
      <h1>Unsubscribe from marketing emails?</h1>
      {result?.error && <p style={{ color: "#d92d20" }}>Something went wrong. Please try again.</p>}
      <Form method="post">
        <button type="submit" style={{ padding: "12px 24px", fontSize: 16, borderRadius: 6, border: 0, background: "#000", color: "#fff", cursor: "pointer" }}>
          Yes, unsubscribe me
        </button>
      </Form>
    </main>
  );
}
