export type Preset = { label: string; prompt: string };

export const PRESETS: Preset[] = [
  {
    label: "Customer Support",
    prompt:
      "A customer writes: 'My order #4521 was supposed to arrive yesterday but tracking still shows it in transit. This is the third time this has happened. I need to know where my package is and what you're going to do about it.' Respond as a helpful support agent. Be empathetic, give a concrete next step, and keep it under 100 words.",
  },
  {
    label: "Code Generation",
    prompt:
      "Write a Python function that takes a list of dictionaries representing user records (with keys 'name', 'email', 'signup_date') and returns the three most recent signups. Include a docstring and handle the case where the input has fewer than 3 records.",
  },
  {
    label: "RAG-style Q&A",
    prompt:
      "Context: Fireworks AI is a generative AI inference platform. It supports open-source LLMs including Llama, Qwen, DeepSeek, and Mixtral. Pricing is per million tokens, with rates varying by model size. Fireworks offers serverless and dedicated GPU deployments.\n\nQuestion: Based only on the context above, what deployment options does Fireworks offer and how is pricing structured?",
  },
];
