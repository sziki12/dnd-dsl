import MenuAppBar from "./MenuAppBar"

export default function PageWrapper({ children, name }: { children: React.ReactNode, name: string }) {

    return (<>
    <MenuAppBar name={name}/>
     {children}
    </>)
}