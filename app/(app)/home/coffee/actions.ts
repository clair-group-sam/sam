"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { brew } from "@/lib/coffee";

export async function brewCoffee(formData?: FormData) {
  const s = await getSession();
  if (!s?.person) redirect("/login");
  const src = formData?.getAll("src").map(String).filter(Boolean);
  await brew(s, src && src.length ? src : undefined);
  revalidatePath("/home/tasks");
  redirect("/home/coffee");
}
