import type { Session, User } from "@supabase/supabase-js";
import { deriveAuthCredential } from "../../supabase/functions/_shared/authCredential";
import { studentIdToInternalEmail } from "./utils";

export interface FirstLoginAuthClient {
  auth: {
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{
      data: { session: Session | null; user: User | null };
      error: unknown;
    }>;
    getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
    getUser: () => Promise<{ data: { user: User | null }; error: unknown }>;
  };
}

export async function reauthenticateAfterFirstLogin(
  client: FirstLoginAuthClient,
  studentId: string,
  expectedUserId: string,
  rawCredential: string
): Promise<{ session: Session; user: User }> {
  const derivedCredential = await deriveAuthCredential(studentId, rawCredential);
  const signedIn = await client.auth.signInWithPassword({
    email: studentIdToInternalEmail(studentId),
    password: derivedCredential
  });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    throw new Error("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  }

  const current = await client.auth.getSession();
  if (current.error || !current.data.session) throw new Error("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data.user || verified.data.user.id !== expectedUserId) {
    throw new Error("FIRST_LOGIN_REAUTHENTICATION_FAILED");
  }
  return {
    session: { ...current.data.session, user: verified.data.user },
    user: verified.data.user
  };
}
