export function Thumb({ product, size }) {
  return (
    <div className={`thumb ${size ?? ''}`}>
      {product.imageUrl ? (
        <img src={product.imageUrl} alt={product.name} />
      ) : (
        product.name[0].toUpperCase()
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Alert({ type = 'error', children }) {
  return children ? <div className={`alert ${type}`}>{children}</div> : null;
}

export function Empty({ children }) {
  return <div className="card empty">{children}</div>;
}

export const money = (value) => `$${Number(value).toFixed(2)}`;
