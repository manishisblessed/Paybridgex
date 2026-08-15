import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-server";

if (!process.env.NEXTAUTH_SECRET) {
  console.error(
    "[nextauth] NEXTAUTH_SECRET is not set. Auth will fail in production. " +
    "Set it in your hosting provider's environment variables."
  );
}
if (!process.env.NEXTAUTH_URL) {
  console.warn(
    "[nextauth] NEXTAUTH_URL is not set. NextAuth will attempt auto-detection " +
    "which may fail behind a reverse proxy or on AWS Amplify. " +
    "Set NEXTAUTH_URL to your production domain (e.g. https://paybridgex.in)."
  );
}

const handler = NextAuth(authOptions);
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export { handler as GET, handler as POST };
