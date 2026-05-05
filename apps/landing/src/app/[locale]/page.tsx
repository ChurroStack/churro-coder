import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { Workflow } from "@/components/Workflow";
import { Screenshots } from "@/components/Screenshots";
import { CtaBanner } from "@/components/CtaBanner";
import { Footer } from "@/components/Footer";

async function getGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/ChurroStack/churro-coder",
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.stargazers_count as number;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const stars = await getGitHubStars();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg)", color: "var(--fg)" }}>
      <Header stars={stars} />
      <main>
        <Hero stars={stars} />
        <Features />
        <Workflow />
        <Screenshots />
        <CtaBanner stars={stars} />
      </main>
      <Footer />
    </div>
  );
}
