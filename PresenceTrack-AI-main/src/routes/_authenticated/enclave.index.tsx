import { createFileRoute, redirect } from "@tanstack/react-router";
import { enclavePathFor } from "@/lib/enclaves";

export const Route = createFileRoute("/_authenticated/enclave/")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: enclavePathFor(context.role), replace: true });
  },
});
