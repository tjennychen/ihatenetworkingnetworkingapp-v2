type CardProps = {
  label: string
  value: number
  rate?: number
  color: string
}

function Card({ label, value, rate, color }: CardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {rate != null && (
          <span className="mb-1 text-sm font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            {rate.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

type Props = {
  sent: number
  accepted: number
}

export default function StatsCards({ sent, accepted }: Props) {
  const rate = sent > 0 ? (accepted / sent) * 100 : 0
  return (
    <div className="grid grid-cols-2 gap-4 max-w-xl mb-8">
      <Card label="Connections Sent"     value={sent}     color="bg-blue-400" />
      <Card label="Connections Accepted" value={accepted} rate={rate} color="bg-green-400" />
    </div>
  )
}
