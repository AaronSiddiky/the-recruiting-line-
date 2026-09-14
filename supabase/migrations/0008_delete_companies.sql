-- RecruitingLine :: any teammate can delete a company. Safe to run repeatedly.
--
-- Deletes were manager-only. With the shared queue every rep already edits
-- and dispositions any lead, and a two-person team has no manager to route
-- bad rows through. Deleting a company cascades to its calls, so the UI
-- confirms first and says how much history goes with it.

drop policy if exists companies_delete on companies;
create policy companies_delete on companies
  for delete to authenticated using (true);
