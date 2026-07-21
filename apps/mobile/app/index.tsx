import { Redirect } from "expo-router";
import { useEffect, useState } from "react";

import { HomeScreen } from "../src/features/home/HomeScreen";
import { AppLaunchScreen } from "../src/features/launch/AppLaunchScreen";
import { env } from "../src/config/env";
import { hasCompletedOnboarding } from "../src/features/onboarding/onboardingStorage";

export default function HomeRoute() {
  const [onboarding, setOnboarding] = useState<"loading" | "complete" | "incomplete">("loading");

  useEffect(() => {
    if (env.e2eFixtureMode) {
      setOnboarding("complete");
      return undefined;
    }

    let active = true;
    void hasCompletedOnboarding().then((completed) => {
      if (active) setOnboarding(completed ? "complete" : "incomplete");
    });
    return () => { active = false; };
  }, []);

  if (onboarding === "loading") {
    return <AppLaunchScreen />;
  }

  if (onboarding === "incomplete") {
    return <Redirect href="/onboarding" />;
  }

  return <HomeScreen />;
}
