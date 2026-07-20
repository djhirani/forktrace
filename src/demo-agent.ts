import { Agent } from "@openai/agents";

export const DEMO_MODEL_IDENTIFIER =
  "forktrace-deterministic-customer-support-v1";

export interface DemoContext {
  customer_records: Array<{
    id: string;
    name: string;
    plan: string;
    active: boolean;
  }>;
  requested_name: string;
  selected_customer_id: string | null;
  lookup_attempts: number;
}

export const demoContext: DemoContext = {
  customer_records: [
    { id: "CUST-1041", name: "John Wheeler", plan: "Pro", active: true },
    { id: "CUST-1042", name: "John Wheeler", plan: "Basic", active: true },
  ],
  requested_name: "John Wheeler",
  selected_customer_id: null,
  lookup_attempts: 0,
};

export const demoAgent = new Agent<DemoContext>({
  name: "ForkTrace deterministic customer lookup demo",
  instructions:
    "Look up the customer, select a customer ID, and request the refund. Return only observable decision output.",
  model: DEMO_MODEL_IDENTIFIER,
  modelSettings: { temperature: 0 },
});
