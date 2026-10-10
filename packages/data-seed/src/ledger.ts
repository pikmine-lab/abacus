import { createAccount } from '@abacus/core/services/accounts'
import { createActor } from '@abacus/core/services/actors'
import { createCategory } from '@abacus/core/services/catalog'
import { HISTORY_START } from './calendar.ts'

/**
 * The referential the rest of the demo writes against. Every name is made up:
 * no bank, merchant or client here is a real one, so nothing reads as somebody's
 * own data.
 */
export async function ledger(userId: string) {
  const account = async (
    name: string,
    behavior: 'payment' | 'savings' | 'investment',
    institution: string,
    openingBalance: number,
  ) =>
    (await createAccount({ userId, name, behavior, institution, openingBalance, openedOn: HISTORY_START })).id

  const accounts = {
    checking: await account('Compte courant', 'payment', 'Banque Démo', 2400),
    savings: await account("Livret d'épargne", 'savings', 'Banque Démo', 8000),
    business: await account('Compte pro', 'payment', 'Néobanque Démo', 1500),
    pea: await account('PEA', 'investment', 'Courtier Démo', 0),
    crypto: await account('Portefeuille crypto', 'investment', 'Plateforme Démo', 0),
    lifeInsurance: await account('Assurance vie', 'investment', 'Assureur Démo', 0),
    joint: await account('Ancien compte joint', 'payment', 'Banque Démo', 320),
  }

  const category = async (name: string, group: string) => (await createCategory(userId, name, group)).id
  const categories = {
    rent: await category('Loyer', 'Logement'),
    energy: await category('Énergie', 'Logement'),
    telecom: await category('Internet et téléphone', 'Logement'),
    homeInsurance: await category('Assurance habitation', 'Logement'),
    groceries: await category('Courses', 'Vie courante'),
    restaurants: await category('Restaurants', 'Vie courante'),
    health: await category('Santé', 'Vie courante'),
    clothing: await category('Vêtements', 'Vie courante'),
    transit: await category('Transports en commun', 'Transport'),
    train: await category('Train', 'Transport'),
    bike: await category('Vélo', 'Transport'),
    streaming: await category('Abonnements', 'Loisirs'),
    sport: await category('Sport', 'Loisirs'),
    outings: await category('Sorties', 'Loisirs'),
    travel: await category('Voyages', 'Loisirs'),
    gifts: await category('Cadeaux', 'Divers'),
    salary: await category('Salaire', 'Revenus'),
    rentalIncome: await category('Location', 'Revenus'),
    software: await category('Logiciels', 'Activité'),
    equipment: await category('Matériel', 'Activité'),
    bankFees: await category('Frais bancaires', 'Activité'),
  }

  const actor = async (name: string, aliases: string[] = []) =>
    (await createActor(userId, { name, aliases })).id
  const actors = {
    employer: await actor('Atelier Lumen'),
    landlord: await actor('Agence Immobilière du Parc'),
    electricity: await actor('Électricité du Littoral'),
    telecom: await actor('Télécom Horizon'),
    insurer: await actor('Assurance Habitat Plus'),
    streaming: await actor('CinéStream'),
    music: await actor('SonoBox'),
    magazine: await actor('Le Quotidien en ligne'),
    gym: await actor('Club Atlas'),
    transit: await actor('Transports Métropole'),
    train: await actor('Rail Express'),
    lender: await actor('Crédit Mobilité'),
    supermarket: await actor('Supermarché du Port', ['SUPER PORT', 'Supermarche du Port']),
    grocer: await actor('Épicerie Centrale'),
    bakery: await actor('Boulangerie du Marché'),
    bistro: await actor("Le Bistrot d'Angle"),
    pizzeria: await actor('Pizzeria Nonna'),
    cafe: await actor('Café des Arts'),
    pharmacy: await actor('Pharmacie de la Gare'),
    clothing: await actor('Boutique Lin & Laine'),
    concert: await actor('Salle Le Phare'),
    londonHotel: await actor('Kensington Rooms'),
    londonMuseum: await actor('London Gallery Shop'),
    londonPub: await actor('The Old Crown'),
    friend: await actor('Alex'),
    family: await actor('Famille'),
    tenant: await actor('Locataire du parking'),
    unknown: await actor('Inconnu'),
  }

  return { accounts, categories, actors }
}

export type Ledger = Awaited<ReturnType<typeof ledger>>
