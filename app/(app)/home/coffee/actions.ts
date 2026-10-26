"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { brew } from "@/lib/coffee";

export async function brewCoffee() {
  const s = await getSession();
  if (!s?.person) redirect("/login");
  await brew(s);
  revalidatePath("/home/tasks");
  redirect("/home/coffee");
}
