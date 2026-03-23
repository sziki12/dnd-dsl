grammar DndDsl

entry Model:
    (World=World);

World:
    'world' name=STRING
    ((locations+=Location)+
    | (functions+=FunctionDeclaration)+
    |(quests+=Quest)+
    |(events+=Event)+)*;

//Location
Location:
    'location' name=STRING
    (entry=LocationEntry)?
    (exits+=LocationExit)*
    (variables+=VariableDeclaration)*
    (Description)?
    ('sublocations' sublocations+=Location* 'end')?;
LocationExit:
    'exit' name=STRING 'to' exit=LocationChain identifiers+=Identifier*;
LocationEntry:
    'entry' entry=LocationChain;
LocationChain:
    locations+=[Location:STRING] ('->' locations+=[Location:STRING])*;
Identifier:
    '['property=ID ((':'|'=') value=ConstantExpression)? ']';

//Quest
Quest:
    'quest' name=STRING
    (Description)?
    (CompleteableEvents)?
    (objectives+=Objective)+;
Objective:
    'objective' name=STRING
    (Description)?
    (CompleteableEvents)?;
QuestExpressions infers BoolExpression:
    QuestCompletedExpression
    | QuestFailedExpression
    | QuestAcceptedExpression
    | ObjectiveExpressions
    ;
QuestCompletedExpression infers BoolExpression:
    'quest' 'completed' target=QuestRef;
QuestFailedExpression infers BoolExpression:
    'quest' 'failed' target=QuestRef;
QuestAcceptedExpression infers BoolExpression:
    'quest' 'accepted' target=QuestRef;

ObjectiveExpressions:
    ObjectiveCompletedExpression
    | ObjectiveFailedExpression
    ;
ObjectiveCompletedExpression infers BoolExpression:
    'objective' 'completed' target=ObjectiveRef;
ObjectiveFailedExpression infers BoolExpression:
    'objective' 'failed' target=ObjectiveRef;

//Event
Event:
    'event' name=STRING
    (Description)?
    (codeBlock=CodeBlock)?;
EventTrigger:
    'trigger' target=EventRef;
EventCalledExpression infers BoolExpression:
    'event' 'triggered' target=EventRef;

//Function
FunctionDeclaration:
    'function' name=ID
    (params+=Parameter)*
    (variables+=VariableDeclaration)*
    (description=STRING)?
    (codeBlock=CodeBlock)?
    'return' (returnValue=(Expression));
FunctionCall:
   'call' ((predefined?='predefined' predefinedTarget=ID) | target=[FunctionDeclaration:ID])  ('with' params+=Expression (',' params+=Expression)*)?;



//Code
CodeBlock:
    (code+=Code)+;
Code:
    FunctionCall
    | VariableAssignment
    | ConditionalBlock
    | EventTrigger
    | VariableDeclaration
    ;
ConditionalBlock:
    'when' condition=BoolExpression 'do' body+=CodeBlock 'end';
VariableAssignment:
    target=[VariableDeclaration:ID] '=' value=(Expression | ObjectDeclaration);


//General Declarations
VariableDeclaration:
    'let' name=ID '=' value=(Expression | ObjectDeclaration);
ObjectDeclaration:
    'object'
    (variables+=VariableDeclaration)*
    (Description)?
    'end';


//Expressions
Expression:
    BoolExpression
    ;
ConstantExpression:
    value=(IntVal | StringVal | BoolVal);
BoolExpression:
    exp1=PrimitiveBoolExpression (operator=('and' | 'or') exp2=BoolExpression)?;
IntExpression:
    exp1=(PrimitiveIntExpression) (operator=('+' | '-' | '*' | '/') exp2=IntExpression)?;
PrimitiveBoolExpression: BoolVal | RefChain | BoolGroup | FunctionCall | QuestExpressions | EventCalledExpression | IntToBoolExpression;
PrimitiveIntExpression: IntVal | RefChain | IntGroup | FunctionCall;
IntToBoolExpression infers BoolExpression:
    exp1=IntExpression (operator=('==' | '!=' | '<' | '>' | '<=' | '>=') exp2=BoolExpression)?;
BoolGroup infers BoolExpression:      
    '(' exp1=BoolExpression ')' (operator=('and' | 'or') exp2=IntExpression)?;
IntGroup infers IntExpression:      
    '(' exp1=IntExpression ')' (operator=('+' | '-' | '*' | '/') exp2=IntExpression)?;

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
Ref:
    VariableRef
    | LocationRef
    | QuestRef
    | EventRef;
RefChain:
    ('this' val+=VariableRef | 'location' val+=LocationRef | 'quest' val+=QuestRef | 'event' val+=EventRef) ('->' val+=Ref)*;
//val is declared, property is generated
VariableRef:        
    val=[VariableDeclaration:ID] | property=ID;
LocationRef:
    val=[Location:STRING];
QuestRef:
    val=[Quest:STRING];
ObjectiveRef:
    val=[Objective:STRING];
EventRef:
    val=[Event:STRING];
//Fragments
fragment Description:
    'description' description=STRING;

fragment CompleteableEvents:
    ('enabled' 'on' enabled+=BoolExpression)?
    ('requierement' requierement+=BoolExpression)?
    ('on' ('completed' completed+=CodeBlock) | ('failed' failed+=CodeBlock))?
    ('on' ('completed' completed+=CodeBlock) | ('failed' failed+=CodeBlock))?;



// Terminals
terminal BooleanValue returns boolean:
    ('true' | 'false');


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
