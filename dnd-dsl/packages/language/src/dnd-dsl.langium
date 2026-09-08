grammar DndDsl

entry Model:
    (World=World)
    ;

World:
    'world' name=STRING
    ((locations+=Location)+
    | (functions+=FunctionDeclaration)+
    | (quests+=Quest)+
    | (events+=Event)+
    | (npcs+=Npc)+
    | (enums+=Enum)+
    | (variables+=VariableDeclaration)+)*
  | isReference?='reference' 'world' name=STRING script=CodeBlock;

Enum:
    'enum' name=ID '{' values+=EnumValueDecl (',' values+=EnumValueDecl)* ','? '}';
EnumValueDecl:
    name=ID;

Npc:
    'npc' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*;

//Location
Location:
    'location' name=STRING
    (entry=LocationEntry)?
    (exits+=LocationExit)*
    (variables+=VariableDeclaration)*
    (Description)?
    ('sublocations' sublocations+=Location* 'end')?;
LocationExit:
    'exit' name=STRING 'to' exit=[Location:STRING] identifiers+=Identifier*;
LocationEntry:
    'entry' entry=[Location:STRING];
//LocationChain:
//    locations+=[Location:STRING] ('->' locations+=[Location:STRING])*;
Identifier:
    '['tag=STRING ((':'|'=') value=ConstantExpression)? ']';

//Quest
Quest:
    'quest' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (CompleteableEvents)?
    (objectives+=Objective)+;
Objective:
    'objective' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (CompleteableEvents)?;
QuestExpressions:
    ('quest' (QuestCompletedExpression
    | QuestFailedExpression
    | QuestAcceptedExpression) | ObjectiveExpressions)
    ;
QuestCompletedExpression:
    'completed' target=QuestRef;
QuestFailedExpression:
    'failed' target=QuestRef;
QuestAcceptedExpression:
    'accepted' target=QuestRef;

ObjectiveExpressions:
    'objective' (ObjectiveCompletedExpression
    | ObjectiveFailedExpression)
    ;
ObjectiveCompletedExpression:
    'completed' target=ObjectiveRef;
ObjectiveFailedExpression:
    'failed' target=ObjectiveRef;

//Event
Event:
    'event' name=STRING
    (Description)?
    (codeBlock=CodeBlock)?;
EventTrigger:
    'trigger' target=EventRef;
EventCalledExpression:
    'event' 'triggered' target=EventRef;

//Function
FunctionDeclaration:
    'function' name=ID
    (params+=Parameter)*
    (description=STRING)?
    (codeBlock=CodeBlock)?
    ;
FunctionCall:
   'call' ((predefined?='predefined' predefinedTarget=ID) | target=FunctionRef)  ('with' params+=Expression (',' params+=Expression)*)?;


//Code
CodeBlock:
    (code+=Code)+;
Code:
    FunctionCall
    | SetStatement
    | VariableAssignment
    | ConditionalBlock
    | EventTrigger
    | VariableDeclaration
    | ReturnStatement
    | RemindStatement
    ;
SetStatement:
    'set' target=RefChain '=' value=(Expression);
ConditionalBlock:
    'when' condition=BoolExpression 'do' body+=CodeBlock 'end';
ReturnStatement:
    'return' (returnValue=(Expression))?;
RemindStatement:
    'remind' label=STRING 'after' delay=Duration
    ('severity' severity=('info' | 'warning' | 'urgent'))?
    ('show' 'on' pin=RefChain)?
    ('do' body=CodeBlock 'end')?;
Duration:
    amount=Expression unit=('round' | 'rounds' | 'minute' | 'minutes' | 'hour' | 'hours' | 'day' | 'days');
VariableAssignment:
    target=VariableRef '=' value=(Expression);


//General Declarations
VariableDeclaration:
    'let' isComputed='computed'? target=ID (':' enumType=[Enum:ID])? '=' value=(Expression);
ObjectDeclaration:
    'object'
    (variables+=VariableDeclaration)*
    (Description)?
    'end';


//Expressions
Expression:
    BoolExpression;

BoolExpression infers Expression:
    exp=ComparisonExpression (
        {infer BoolExpression.left=current} 
        operator=('and' | 'or') 
        right=ComparisonExpression
    )*;
ComparisonExpression infers Expression:
    exp=IntExpression (
        {infer IntToBoolExpression.left=current}
        ( operator=('==' | '!=' | '<' | '>' | '<=' | '>=')
        | operator='is' (negated?='not')? )
        right=IntExpression
    )?;
IntExpression infers Expression:
    exp=MultiplicativeExpression (
        {infer IntExpression.left=current}
        operator=('+' | '-')
        right=MultiplicativeExpression
    )*;
MultiplicativeExpression infers Expression:
    exp=PrimaryExpression (
        {infer IntExpression.left=current}
        operator=('*' | '/')
        right=PrimaryExpression
    )*;
PrimaryExpression infers Expression:
    {infer GroupedExpression} '(' exp=Expression ')' |
    EnumValueRef |
    ReferenceExpression |
    ConstantExpression;
ConstantExpression:
    IntVal |
    StringVal |
    BoolVal |
    ObjectDeclaration
    ;
// `enumName` is a plain token (ENUM_NAME only matches an identifier immediately
// followed by `::`), which keeps `EnumName::Value` unambiguous against a bare
// variable reference in the same expression slot. The enum is resolved by name in
// the scope provider and validator.
EnumValueRef:
    enumName=ENUM_NAME '::' value=[EnumValueDecl:ID];
ReferenceExpression:
    FunctionCall |
    QuestExpressions |
    EventCalledExpression |
    RefChain
    ;

//Values
IntVal:        
   isNegative?='-'? val=INT;
BoolVal: 
    isNegated?='not'? val=BooleanValue;
StringVal: 
    val=STRING;
Parameter infers VariableDeclaration:
    'param' name=ID;

//References
RefChain:
    first=RefChainStart ('.' rest+=VariableRefItem)*;

RefChainStart:
    VariableRefItem
    | LocationRefItem
    | QuestRefItem
    | EventRefItem
    | NpcRefItem;

VariableRefItem:
    val=VariableRef;
LocationRefItem:
    isLocation='location' val=LocationRef;
QuestRefItem:
    isQuest='quest' val=QuestRef;
EventRefItem:
    isEvent='event' val=EventRef;
NpcRefItem:
    isNpc='npc' val=NpcRef;

//val is declared, property is generated
VariableRef:        
    val=[VariableDeclaration:ID];
LocationRef:
    val=[Location:STRING];
QuestRef:
    val=[Quest:STRING];
ObjectiveRef:
    val=[Objective:STRING];
EventRef:
    val=[Event:STRING];
NpcRef:
    val=[Npc:STRING];
FunctionRef:
    val=[FunctionDeclaration:ID];

//Fragments
fragment Description:
    'description' description=STRING;

fragment CompleteableEvents:
    ('enabled' 'on' enabled+=BoolExpression)?
    ('requierement' requierement+=BoolExpression)?
    ('on' ('completed' completed+=CodeBlock) | ('failed' failed+=CodeBlock))*;



// Terminals
terminal BooleanValue returns boolean:
    ('true' | 'false');


hidden terminal WS: /\s+/;
// An identifier immediately followed by `::` - the qualifier of an EnumName::Value
// reference. Declared before ID so `Foo::` lexes as ENUM_NAME while a bare `Foo`
// stays an ID.
terminal ENUM_NAME: /[_a-zA-Z][\w_]*(?=::)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
