import { describe, expect, it } from "vitest";
import { buildPrompt, stripSpeakerLabels } from "../src/lib/ai.js";

describe("stripSpeakerLabels", () => {
  it("returns a normal one-voice reply unchanged", () => {
    const reply = "Great idea, boss! Alibaba dey big market.\n\nNext step: set up the seller account.";
    expect(stripSpeakerLabels(reply, { botName: "Noti", ownerName: "Kwame" })).toBe(reply);
  });

  it("strips a hallucinated two-hand script down to the assistant's own turns", () => {
    const script = [
      "Boss: Ah, wahala! 😊 I've been thinking about expanding our online business.",
      "You: I think it's a great idea, boss! Alibaba is one of the largest platforms.",
      "Boss: What kind of requirements do we need?",
      "You: We need a high-quality product and a solid marketing strategy.",
    ].join("\n");

    const cleaned = stripSpeakerLabels(script, { botName: "Noti", ownerName: "Kwame" });

    expect(cleaned).not.toContain("Boss:");
    expect(cleaned).not.toContain("You:");
    expect(cleaned).toContain("Alibaba is one of the largest platforms.");
    expect(cleaned).toContain("solid marketing strategy");
    expect(cleaned).not.toContain("whara"); // no fabricated boss lines left
  });

  it("drops a single leading speaker label", () => {
    const cleaned = stripSpeakerLabels("You: Sure, the logo is ready.", {
      botName: "Noti",
      ownerName: "Kwame",
    });
    expect(cleaned).toBe("Sure, the logo is ready.");
  });

  it("recognises the configured bot and owner names as speakers", () => {
    const script = "Kwame: Come to the shop by 5.\nNoti: I go let them know, boss.";
    const cleaned = stripSpeakerLabels(script, { botName: "Noti", ownerName: "Kwame" });
    expect(cleaned).toBe("I go let them know, boss.");
  });

  it("does not treat markdown or list colons as speaker labels", () => {
    const reply = "- price: we sell at GHS 50\n- delivery: within Accra\n**Note:** stock is limited";
    expect(stripSpeakerLabels(reply, { botName: "Noti", ownerName: "Kwame" })).toBe(reply);
  });

  it("keeps the reply when no turn is labelled as the assistant", () => {
    const script = "Boss: Hello?\nCustomer: Hi there";
    const cleaned = stripSpeakerLabels(script, { botName: "Noti", ownerName: "Kwame" });
    expect(cleaned).toContain("Hello?");
    expect(cleaned).toContain("Hi there");
  });

  it("returns empty input unchanged", () => {
    expect(stripSpeakerLabels("", { botName: "Noti", ownerName: "Kwame" })).toBe("");
  });
});

describe("buildPrompt format rule", () => {
  it("forbids two-sided scripts in every mode", () => {
    for (const mode of ["direct", "secretary", "welcome", "plain"] as const) {
      const prompt = buildPrompt({ mode, text: "Hello", botName: "Noti", ownerName: "Kwame" });
      expect(prompt).toContain("single message spoken only by you");
      expect(prompt).toContain("NEVER write a two-sided script");
    }
  });

  it("does not tell the direct-mode model it is speaking in customer chats", () => {
    const prompt = buildPrompt({ mode: "direct", text: "Hi", botName: "Noti", ownerName: "Kwame" });
    expect(prompt).not.toContain("own chats with his customers");
  });

  it("sanitises scripted assistant replies already stored in memory", () => {
    const prompt = buildPrompt({
      mode: "direct",
      text: "Where do I start?",
      botName: "Noti",
      ownerName: "Kwame",
      memory: [
        { role: "them", text: "What do you think about my idea" },
        {
          role: "us",
          text: "Boss: Ah, wahala! 😊\nYou: I think it's a great idea, boss!",
        },
      ],
    });

    expect(prompt).not.toContain("Boss: Ah, wahala");
    expect(prompt).toContain("I think it's a great idea, boss!");
    expect(prompt).toContain("What do you think about my idea"); // user's real line kept
  });
});
