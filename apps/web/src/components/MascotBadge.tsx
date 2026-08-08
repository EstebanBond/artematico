import mascotFace from '../assets/mascot-face.png';

interface MascotBadgeProps {
  size?: number;
}

// Icono chico del mentor-robot, usado en el encabezado de cada pantalla para
// que se sienta como el mismo personaje acompañando todo el recorrido.
export function MascotBadge({ size = 40 }: MascotBadgeProps) {
  return (
    <img
      className="mascot-badge"
      src={mascotFace}
      alt=""
      role="presentation"
      width={size}
      height={size}
    />
  );
}
