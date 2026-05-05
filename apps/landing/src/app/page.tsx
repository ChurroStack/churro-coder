import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function RootPage() {
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language") ?? "";
  const locale = acceptLanguage.toLowerCase().startsWith("es") ? "es" : "en";
  redirect(`/${locale}`);
}
