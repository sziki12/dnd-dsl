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
    | (states+=State)+
    | (variables+=VariableDeclaration)+
    | (onBlocks+=OnBlock)+
    | (parties+=Party)+
    | (factions+=Faction)+
    | (relationTypes+=RelationType)+)*
  | isReference?='reference' 'world' name=STRING (script=CodeBlock)?;

State:
    'state' name=ID '{' values+=StateValueDecl (',' values+=StateValueDecl)* ','? '}';
StateValueDecl:
    name=ID;

Npc:
    'npc' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*
    (relations+=Relation)*;

Party:
    'party' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*;

Faction:
    'faction' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*
    (relations+=Relation)*;

// A relation type: which kinds of entity it may start from and point at. Only the built-in ones exist for now
// (see BUILTIN_SOURCE); the validator rejects a declaration in a world.
RelationType:
    'relation' name=STRING
    (Description)?
    'from' sources+=RelationKind (',' sources+=RelationKind)*
    'to' targets+=RelationKind (',' targets+=RelationKind)*;

RelationKind returns string:
    'faction' | 'npc' | 'party' | 'location' | 'quest';

// A fact, written inside the entity it starts from: `"Member of" faction "Guards"`. Its own variables and `on` blocks
// follow it, so the host's own `let`s and `on`s must be written before its first fact.
Relation:
    predicate=[RelationType:STRING] target=RelationEndpoint
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*;

// Literal kind-keyword references only, so `this`, variables, `world`, `state` and `event` cannot be a fact's target.
RelationEndpoint:
    FactionRefItem | NpcRefItem;

//Location
Location:
    'location' name=STRING
    (entry=LocationEntry)?
    (exits+=LocationExit)*
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*
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
    (onBlocks+=OnBlock)*
    (CompleteableEvents)?
    (objectives+=Objective)+;
Objective:
    'objective' name=STRING
    (Description)?
    (variables+=VariableDeclaration)*
    (onBlocks+=OnBlock)*
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
    (codeBlock=CodeBlock)?
    (onBlocks+=OnBlock)*;
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


//On Change Handlers
OnBlock:
    'on' (occurrence=ChangeOccurrence | occurrence=TriggerOccurrence) 'do' body=CodeBlock 'end';
ChangeOccurrence:
    'change' target=RefChain (('to' toValue=Expression) | ('when' guard=BoolExpression))?;
TriggerOccurrence:
    'trigger' target=EventRef;

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
    | PrintStatement
    | ForStatement
    | QuestStatements
    ;
//General Statements
SetStatement:
    'set' target=RefChain ('=' | 'to') value=(Expression);
ConditionalBlock:
    'when' condition=BoolExpression 'do' body+=CodeBlock ('otherwise' 'do' otherwise+=CodeBlock)? 'end';
ReturnStatement:
    'return' (returnValue=(Expression))?;
VariableAssignment:
    target=VariableRef ('=' | 'to') value=(Expression);
PrintStatement:
    'print' value=(Expression);

//Remind Statement
RemindStatement:
    'remind' label=STRING ('after' delay=Duration)?
    ('severity' severity=('info' | 'warning' | 'urgent'))?
    ('show' 'on' pin=RefChain)?
    ('do' body=CodeBlock 'end')?;
Duration:
    amount=Expression unit=('round' | 'rounds' | 'minute' | 'minutes' | 'hour' | 'hours' | 'day' | 'days');

//For Loops
ForStatement:
    'for' loopVar=LoopVariable 'in' source=RefChain 'do' body+=CodeBlock 'end';
LoopVariable infers VariableDeclaration:
    name=ID;
    
//Quest Statements
QuestStatements:
    AcceptQuest |
    FailStatement |
    CompleteStatement;
AcceptQuest infers QuestStatements:
    status='accept' 'quest' target=QuestRef;
FailStatement infers QuestStatements:
    status='fail' ('quest' target=QuestRef | 'objective' target=ObjectiveRef);
CompleteStatement infers QuestStatements:
    status='complete' ('quest' target=QuestRef | 'objective' target=ObjectiveRef);

//General Declarations
VariableDeclaration:
    'let' isComputed='computed'? target=ID (':' stateType=[State:ID] (isList?='[' ']')?)? '=' value=(Expression);
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
    StateValueRef |
    ReferenceExpression |
    ConstantExpression;
ConstantExpression:
    IntVal |
    StringVal |
    BoolVal |
    ObjectDeclaration |
    ListLiteral
    ;
ListLiteral:
    '[' (elements+=Expression (',' elements+=Expression)* ','?)? ']';
// `stateName` is a plain token (STATE_NAME only matches an identifier immediately
// followed by `::`), which keeps `StateName::Value` unambiguous against a bare
// variable reference in the same expression slot. The state is resolved by name in
// the scope provider and validator.
StateValueRef:
    stateName=STATE_NAME '::' value=[StateValueDecl:ID];
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
// `first` / `rest` / `field` / `indexes` are the chain's first segment. After at least one index the chain may
// carry on through `next`, a segment of the same shape, because the indexed item is itself something with members:
// `quest "Q" . objectives[0] . Status`, `world . quests["Rising Dead"] . objectives[1] . Status`.
// A step down to a child (`->`, or `. sublocations "B"` / `. objectives "O"`) is kept in `steps`, after the head it
// starts from. The chain then continues from the LAST step, so the entity a chain's head denotes is `chainHead(chain)`
// (the last step, else `first`); both spellings mean the same thing, and names are unique, so nothing after the head
// needs to know the path. A step is told from the plain collection field by the string after it: `. sublocations "B"`
// is a step, `. sublocations` and `. sublocations[0]` are the collection. That lookahead works because the members
// and the field that follow are in this same rule; in the head rules a trailing repetition is decided on its first
// token alone, which cannot tell `. sublocations "B"` from `. Torches`.
RefChain:
    (   first=LocationRefItem (steps+=LocationStep)*
      | first=QuestRefItem (steps+=ObjectiveStep)?
      | first=RefChainHead )
    ('.' rest+=VariableRefItem)* ('.' field=ChainField)?
    (('[' indexes+=Expression ']')+ next=ChainTail?)?;

LocationStep infers LocationRefItem:
    ('->' | '.' 'sublocations') val=LocationRef;
ObjectiveStep infers ObjectiveRefItem:
    ('->' | '.' 'objectives') val=ObjectiveRef;

ChainTail:
    ('.' rest+=VariableRefItem)+ ('.' field=ChainField)? (('[' indexes+=Expression ']')+ next=ChainTail?)?
    | '.' field=ChainField (('[' indexes+=Expression ']')+ next=ChainTail?)?;

ChainField returns string:
    //Collection fields
    'locations' | 'npcs' | 'factions' | 'quests' | 'events' | 'functions'
    | 'states' | 'variables' | 'sublocations' | 'exits' | 'objectives' | 'values'
    //Single-value fields
    | 'name' | 'description';

//QuestRefItem and LocationRefItem handled by RefChain directly
RefChainHead infers RefChainStart:
    VariableRefItem
    | ObjectiveRefItem
    | EventRefItem
    | NpcRefItem
    | FactionRefItem
    | RelationRefItem
    | WorldRefItem
    | StateRefItem
    | ThisRefItem
    | ParentRefItem
    | PartyRefItem;

VariableRefItem:
    val=VariableRef;

LocationRefItem:
    isLocation='location' val=LocationRef;
QuestRefItem:
    isQuest='quest' val=QuestRef;
// Objective names are unique across every quest (see the validator), so `objective "X"` names one on its own.
// `objective completed "X"` / `objective failed "X"` (ObjectiveExpressions) are told apart by the keyword that follows.
ObjectiveRefItem:
    isObjective='objective' val=ObjectiveRef;
EventRefItem:
    isEvent='event' val=EventRef;
NpcRefItem:
    isNpc='npc' val=NpcRef;
FactionRefItem:
    isFaction='faction' val=FactionRef;
// `relation npc "Ann" "Member of" faction "Guards"`: whether that fact is written, or with `. Var` one of its variables.
RelationRefItem:
    isRelation='relation' subject=RelationEndpoint predicate=[RelationType:STRING] target=RelationEndpoint;
// Only one World per document, so a bare keyword is enough - no cross-reference to
// resolve. Exists so `world . npcs` etc. can be written as a CollectionRef head.
WorldRefItem:
    isWorld='world';
// A single-level cross-reference
StateRefItem:
    isState='state' val=[State:ID];
// Resolved by container-walk, not cross-reference - see DndScopeProvider (inside an
// `object...end` block) and LangiumInterpreterService.fireHandler (inside a handler
// body). Restricted to those two positions by DndDslValidator - see below.
ThisRefItem:
    isThis='this';
ParentRefItem:
    isParent='parent';
PartyRefItem:
    isParty='party' name?=STRING;

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
FactionRef:
    val=[Faction:STRING];
FunctionRef:
    val=[FunctionDeclaration:ID];


//Fragments
fragment Description:
    'description' description=STRING;

fragment CompleteableEvents:
    ('enabled' 'on' enabled+=BoolExpression)?
    ('requierement' requierement+=BoolExpression)?
    ('on' ('completed' completed+=CodeBlock | 'failed' failed+=CodeBlock))*;



// Terminals
terminal BooleanValue returns boolean:
    ('true' | 'false');


hidden terminal WS: /\s+/;
// An identifier immediately followed by `::` - the qualifier of a StateName::Value
// reference. Declared before ID so `Foo::` lexes as STATE_NAME while a bare `Foo`
// stays an ID.
terminal STATE_NAME: /[_a-zA-Z][\w_]*(?=::)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
