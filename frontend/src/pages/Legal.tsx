import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Alert, PageHead } from '../components/ui'
export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const { config } = useAuth()
  return (
    <article className="legal">
      <PageHead
        eyebrow="FoodLink information"
        title={kind === 'privacy' ? 'Privacy & account data' : 'Terms & food guidance'}
      />
      {!config.legalReady && (
        <Alert kind="warning">
          This installation is configured for local evaluation. The operator must complete organization,
          contact and retention details and review these notices before inviting real users.
        </Alert>
      )}
      {kind === 'privacy' ? (
        <>
          <h2>Who operates this service</h2>
          <p>
            {config.organizationName}
            {config.organizationAddress ? ` — ${config.organizationAddress}` : ''} manages this FoodLink
            installation.
          </p>
          <p>
            Privacy contact:{' '}
            {config.privacyContact ? (
              <a href={`mailto:${config.privacyContact}`}>{config.privacyContact}</a>
            ) : (
              'Not yet configured by the operator.'
            )}
          </p>
          <h2>Information used by FoodLink</h2>
          <p>
            Accounts contain a name, email, role, password hash and verification status. Optional household,
            dietary, access and address details help the team review recipient eligibility or arrange
            collection and delivery. Only provide details needed for these purposes.
          </p>
          <p>
            The service records donations, food metadata and images, reservations, collection tickets,
            delivery confirmations, messages and changes to operational records. Your profile and activity are
            visible to authorized staff as needed for their work. Assigned delivery volunteers receive the
            details needed for handover.
          </p>
          <h2>Sessions, email and payments</h2>
          <p>
            An essential session cookie keeps you signed in. Account identity is checked on the server. This
            application does not include advertising or analytics trackers. Verification, recovery and
            operational messages are queued through the operator’s configured email service.
          </p>
          <p>
            If purchasing is enabled, payment is handled on the configured payment provider’s hosted checkout.
            FoodLink stores payment references and status, not payment card details.
          </p>
          <h2>Retention and your choices</h2>
          <p>
            The configured retention review period is {config.retentionDays} days. This is an operator policy
            setting; it does not automatically authorize retention or promise deletion on a fixed date.
            Operational and payment records may require a separate retention decision.
          </p>
          <p>
            Use your <Link to="/profile">account page</Link> to update optional details, download your data,
            or deactivate and request a deletion review. Deactivation prevents further sign-in immediately.
            The operator reviews erasure or anonymization while preserving records it must retain.
          </p>
          <h2>Before public operation</h2>
          <p>
            The operator must establish the applicable legal basis, service providers, retention schedule,
            rights-request procedure and required jurisdiction-specific disclosures. This software notice
            alone does not establish compliance.
          </p>
        </>
      ) : (
        <>
          <h2>Using the service</h2>
          <p>
            Provide accurate account and food information, keep your password and collection ticket private,
            and use the role assigned to your account. Recipient reservations require email verification and
            operator eligibility approval.
          </p>
          <p>
            Availability is checked when your reservation is submitted. An offer is not available for
            reservation until staff have received it. Check your order status before travelling and collect
            during your selected event window. Cancel promptly if you cannot attend.
          </p>
          <h2>Food information and handover</h2>
          <p>
            Donors must describe quantity, storage, expiry, allergens and handling instructions accurately.
            Staff check the offered food before receiving it. Do not offer food that is unsafe, damaged or
            unsuitable for distribution.
          </p>
          <p>
            Recipients and buyers should check labels, allergens, packaging, dates and storage instructions at
            handover. An empty allergen field does not mean allergen-free. Contact the operator when
            information is missing or unclear. FoodLink does not provide dietary or food-safety certification.
          </p>
          <h2>Purchases and delivery</h2>
          <p>
            Surplus purchases are available only when the operator enables payment processing. The checkout
            shows the currency and total. A returned checkout page is not payment confirmation; check the
            recorded payment status. Refund requests are reflected in the order’s status.
          </p>
          <p>
            Delivery is available only for events that offer it and depends on volunteer assignment. A request
            is not a promise of a particular delivery time. The assigned volunteer records the completed
            handover.
          </p>
          <h2>Support and operator terms</h2>
          <p>
            Support contact:{' '}
            {config.supportEmail ? (
              <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>
            ) : (
              'Not yet configured by the operator.'
            )}
          </p>
          <p>
            The operator must provide applicable cancellation, refund, complaints, consumer and food-handling
            policies before public use. These general application instructions do not replace
            operator-specific terms.
          </p>
        </>
      )}
    </article>
  )
}
