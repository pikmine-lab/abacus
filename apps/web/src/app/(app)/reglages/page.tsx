import { auth } from '@abacus/core/auth'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ActionForm, SubmitButton } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader, Section } from '@/components/page-shell'
import { Input } from '@/components/ui/input'
import { createActivityAction, createActorAction, createCategoryAction } from '@/lib/actions'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Réglages' }

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  const [categories, activities, actors] = await Promise.all([
    listCategories(userId),
    listActivities(userId),
    listActors(userId),
  ])

  return (
    <>
      <PageHeader title="Réglages" description="ton vocabulaire" />

      <PageBody>
        <Section
          title="Catégories"
          description="la nature d’un mouvement : « Courses », « Loyer », « Salaire ». À plat, groupe optionnel."
        >
          {categories.length === 0 ? (
            <EmptyLine>Aucune catégorie. Sans elles, l’analyse par catégorie reste vide.</EmptyLine>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <span
                  key={c.id}
                  className="rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground"
                >
                  {c.name}
                  {c.groupLabel && <span className="ml-1.5 text-[10.5px] text-faint">{c.groupLabel}</span>}
                </span>
              ))}
            </div>
          )}
          <ActionForm action={createCategoryAction} className="flex-row gap-2" successLabel="Catégorie créée">
            <Input name="name" required placeholder="Nouvelle catégorie" className="h-8 w-48 text-[13px]" />
            <Input name="group" placeholder="Groupe (optionnel)" className="h-8 w-40 text-[13px]" />
            <SubmitButton variant="outline" size="sm">
              Ajouter
            </SubmitButton>
          </ActionForm>
        </Section>

        <Section
          title="Activités"
          description="la sphère économique : « Freelance ». Héritée de l’acteur, surchargeable par mouvement."
        >
          {activities.length === 0 ? (
            <EmptyLine>Aucune activité. Tout est considéré comme perso.</EmptyLine>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activities.map((a) => (
                <span
                  key={a.id}
                  className="rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground"
                >
                  {a.name}
                </span>
              ))}
            </div>
          )}
          <ActionForm action={createActivityAction} className="flex-row gap-2" successLabel="Activité créée">
            <Input name="name" required placeholder="Nouvelle activité" className="h-8 w-48 text-[13px]" />
            <SubmitButton variant="outline" size="sm">
              Ajouter
            </SubmitButton>
          </ActionForm>
        </Section>

        <Section
          title="Acteurs"
          description={`${actors.length} contreparties connues · créées automatiquement à la première déclaration`}
        >
          {actors.length > 0 && (
            <p className="text-[12px] leading-relaxed text-faint">{actors.map((a) => a.name).join(' · ')}</p>
          )}
          <ActionForm action={createActorAction} className="flex-row gap-2" successLabel="Acteur créé">
            <Input name="name" required placeholder="Nouvel acteur" className="h-8 w-48 text-[13px]" />
            <SubmitButton variant="outline" size="sm">
              Ajouter
            </SubmitButton>
          </ActionForm>
        </Section>
      </PageBody>
    </>
  )
}
