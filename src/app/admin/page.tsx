import { Check, CircleDashed } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const plannedModules = [
  "Products & variants",
  "Categories & brands",
  "Inventory & stock movements",
  "Orders & customers",
  "Promotions & reports",
  "Users & settings",
];

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium tracking-widest text-primary">
          HAUS OF DINK / WORKSPACE
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          A solid start.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Your store’s management workspace, ready for its next chapter.
        </p>
      </div>
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Project foundation</CardTitle>
            <Badge>Phase 01</Badge>
          </div>
          <CardDescription>
            Application structure and layouts are in place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 text-sm">
            <Check aria-hidden="true" className="size-4 text-primary" />
            Storefront and admin shells
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            This is a public placeholder. Authentication and server-side admin
            authorization must be implemented before adding protected data or
            actions.
          </p>
        </CardContent>
      </Card>
      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="mb-4 text-xl font-semibold">
          On the roadmap
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plannedModules.map((name) => (
            <Card key={name}>
              <CardHeader>
                <CircleDashed
                  aria-hidden="true"
                  className="mb-3 size-5 text-muted-foreground"
                />
                <CardTitle className="text-base">{name}</CardTitle>
                <CardDescription>Planned for a future phase</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
