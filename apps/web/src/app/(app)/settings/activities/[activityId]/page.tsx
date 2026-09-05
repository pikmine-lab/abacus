import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listInputs, listLevies, listThresholds } from '@abacus/core/services/levies'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import {
  InputRows,
  LevyRows,
  NewInputForm,
  NewLevyForm,
  NewThresholdForm,
  ThresholdRows,
} from '@/components/activity-rules'
import { EntrySheet } from '@/components/entry-sheet'
import { EmptyLine, PageBody, PageHeader, Section } from '@/components/page-shell'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Réglages de l’activité' }

/**
 * The regime of an activity, in data: what it owes and on which source, the
 * figures its rules read, the thresholds it is watched against. Nothing here
 * computes: it says what the engine will read.
 */
export default async function ActivitySettingsPage({ params }: { params: Promise<{ activityId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { activityId } = await params

  const activities = await listActivities(userId)
  // An id that designates nothing for this user is a 404, never someone else's
  // activity: the lookup is scoped to them before anything is read.
  const activity = activities.find((a) => a.id === activityId)
  if (!activity) notFound()

  const [levies, inputs, thresholds, categories] = await Promise.all([
    listLevies(userId, activity.id),
    listInputs(userId, activity.id),
    listThresholds(userId, activity.id),
    listCategories(userId),
  ])
  const now = today()
  const names = levies.map((levy) => ({ id: levy.id, name: levy.name }))

  return (
    <>
      <PageHeader
        title={`Réglages de ${activity.name}`}
        description={
          activity.kind === 'business'
            ? (activity.regimeLabel ?? 'ce que l’activité doit, en données datées et sourcées')
            : 'activité perso : elle ne porte ni règle, ni paramètre, ni seuil'
        }
      />

      <PageBody>
        {activity.kind !== 'business' ? (
          <EmptyLine>
            Cette activité est perso : c’est une dimension d’analyse. Seule une activité professionnelle porte
            un régime.
          </EmptyLine>
        ) : (
          <>
            <Section
              title="Règles"
              description="ce que l’activité doit : une base, une forme de montant, un calendrier, une source"
              action={
                <EntrySheet
                  label="Règle"
                  title="Nouvelle règle"
                  description="Un prélèvement, tel que son texte le fixe. Un taux qui change plus tard ne se corrige pas : il se remplace."
                  variant="outline"
                >
                  <NewLevyForm activityId={activity.id} categories={categories} levies={names} today={now} />
                </EntrySheet>
              }
            >
              {levies.length === 0 ? (
                <EmptyLine>
                  Aucune règle. Sans elles, les charges de l’activité ne se calculent pas.
                </EmptyLine>
              ) : (
                <LevyRows activityId={activity.id} levies={levies} categories={categories} today={now} />
              )}
            </Section>

            <Section
              title="Paramètres saisis"
              description="les chiffres qu’aucun calcul ne donne : une base choisie, un avis, un taux estimé"
            >
              {inputs.length === 0 ? (
                <EmptyLine>Aucun paramètre saisi.</EmptyLine>
              ) : (
                <InputRows activityId={activity.id} inputs={inputs} />
              )}
              <NewInputForm activityId={activity.id} today={now} />
            </Section>

            <Section
              title="Seuils surveillés"
              description="ce qui change de régime au-delà d’une valeur : l’app alerte, elle ne bascule rien"
              action={
                <EntrySheet
                  label="Seuil"
                  title="Nouveau seuil"
                  description="Une mesure, une valeur, et la phrase qui dit ce qui change au-delà."
                  variant="outline"
                >
                  <NewThresholdForm activityId={activity.id} today={now} />
                </EntrySheet>
              }
            >
              {thresholds.length === 0 ? (
                <EmptyLine>Aucun seuil surveillé.</EmptyLine>
              ) : (
                <ThresholdRows activityId={activity.id} thresholds={thresholds} today={now} />
              )}
            </Section>
          </>
        )}
      </PageBody>
    </>
  )
}
