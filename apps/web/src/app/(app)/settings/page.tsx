import { auth } from '@abacus/core/auth'
import { listActorsWithAliases } from '@abacus/core/services/actors'
import {
  CATEGORY_SORTS,
  DEFAULT_CATEGORY_SORT,
  DEFAULT_NAME_SORT,
  listActivities,
  listCategories,
  NAME_SORTS,
  sortByName,
  sortCategories,
} from '@abacus/core/services/catalog'
import { readingPreference } from '@abacus/core/services/preferences'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ActionForm, SubmitButton } from '@/components/forms'
import { EmptyLine, PageBody, PageHeader, Section } from '@/components/page-shell'
import { ReadingPreference } from '@/components/reading-preference'
import { ActivityRows, ActorRows, CategoryRows } from '@/components/referential-rows'
import { SortMenu } from '@/components/sort'
import { Input } from '@/components/ui/input'
import { createActivityAction, createActorAction, createCategoryAction } from '@/lib/actions'
import { sorter } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Réglages' }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  const categorySort = sorter('categories', CATEGORY_SORTS, DEFAULT_CATEGORY_SORT, params)
  const activitySort = sorter('activities', NAME_SORTS, DEFAULT_NAME_SORT, params)
  const actorSort = sorter('actors', NAME_SORTS, DEFAULT_NAME_SORT, params)

  const [categories, activities, actors, reading] = await Promise.all([
    listCategories(userId),
    listActivities(userId),
    listActorsWithAliases(userId),
    readingPreference(userId),
  ])

  return (
    <>
      <PageHeader title="Réglages" description="tes préférences et ton vocabulaire" />

      <PageBody>
        <Section
          title="Mois compté"
          description="la lecture dans laquelle chaque session s’ouvre : le jour où l’argent a bougé, ou le mois concerné."
        >
          <ReadingPreference value={reading} />
        </Section>

        <Section
          title="Catégories"
          description="la nature d’un mouvement : « Courses », « Loyer », « Salaire ». À plat, groupe optionnel."
          action={
            categories.length > 1 && (
              <SortMenu
                sorter={categorySort}
                options={[
                  { field: 'group', label: 'Groupe' },
                  { field: 'name', label: 'Nom' },
                ]}
              />
            )
          }
        >
          {categories.length === 0 ? (
            <EmptyLine>Aucune catégorie. Sans elles, l’analyse par catégorie reste vide.</EmptyLine>
          ) : (
            <CategoryRows categories={sortCategories(categories, categorySort.current)} />
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
          action={
            activities.length > 1 && (
              <SortMenu sorter={activitySort} options={[{ field: 'name', label: 'Nom' }]} />
            )
          }
        >
          {activities.length === 0 ? (
            <EmptyLine>Aucune activité. Tout est considéré comme perso.</EmptyLine>
          ) : (
            <ActivityRows activities={sortByName(activities, activitySort.current)} />
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
          action={
            actors.length > 1 && <SortMenu sorter={actorSort} options={[{ field: 'name', label: 'Nom' }]} />
          }
        >
          {actors.length === 0 ? (
            <EmptyLine>Aucun acteur. Le premier mouvement déclaré en crée un.</EmptyLine>
          ) : (
            <ActorRows actors={sortByName(actors, actorSort.current)} activities={activities} />
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
