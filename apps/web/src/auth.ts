import NextAuth, { type NextAuthResult } from "next-auth";
import { authOptions } from "@/lib/auth-options";

const result: NextAuthResult = NextAuth(authOptions);
export const { handlers, auth, signIn, signOut } = result;
